import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import * as Tone from 'tone';
import {
  GoogleGenAI,
  type LiveMusicGenerationConfig,
  type LiveMusicServerMessage,
  type LiveMusicSession,
} from '@google/genai';
import { decode, decodeAudioData } from '../utils';
import './IntegratedMusicPage.css';

const ai = new GoogleGenAI({
  apiKey: process.env.REACT_APP_GEMINI_API_KEY,
  apiVersion: 'v1alpha',
});
let model = 'lyria-realtime-exp';

interface PianoKey {
  note: string;
  isBlack: boolean;
  keyCode: string;
  displayName: string;
  id: string;
}

interface NoteEvent {
  note: string;
  octave: number;
  instrument: string;
  timestamp: number;
  duration: number;
  velocity?: number;
}

interface Prompt {
  readonly promptId: string;
  readonly color: string;
  text: string;
  weight: number;
}

type PlaybackState = 'stopped' | 'playing' | 'loading' | 'paused';

// Add this WeightSlider component after the existing interfaces and before the main component
interface WeightSliderProps {
  value: number;
  color: string;
  onChange: (value: number) => void;
}

const WeightSlider: React.FC<WeightSliderProps> = ({ value, color, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartPos, setDragStartPos] = useState(0);
  const [dragStartValue, setDragStartValue] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    
    const containerBounds = containerRef.current.getBoundingClientRect();
    setDragStartPos(e.clientY);
    setDragStartValue(value);
    setIsDragging(true);
    document.body.classList.add('dragging');
  }, [value]);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging || !containerRef.current) return;
    
    const containerBounds = containerRef.current.getBoundingClientRect();
    const trackHeight = containerBounds.height;
    const relativeY = e.clientY - containerBounds.top;
    const normalizedValue = 1 - Math.max(0, Math.min(trackHeight, relativeY)) / trackHeight;
    const newValue = normalizedValue * 2;
    onChange(Math.max(0, Math.min(2, newValue)));
  }, [isDragging, onChange]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
    document.body.classList.remove('dragging');
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY;
    const newValue = value + delta * -0.005;
    onChange(Math.max(0, Math.min(2, newValue)));
  }, [value, onChange]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp, { once: true });
      return () => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
    }
  }, [isDragging, handlePointerMove, handlePointerUp]);

  const thumbHeightPercent = (value / 2) * 100;
  const displayValue = value.toFixed(2);

  return (
    <div
      ref={containerRef}
      className="weight-slider"
      onPointerDown={handlePointerDown}
      onWheel={handleWheel}
    >
      <div className="scroll-container">
        <div className="slider-container">
          <div 
            className="thumb"
            style={{
              height: `${Math.max(thumbHeightPercent, 5)}%`,
              backgroundColor: color,
              opacity: value > 0.01 ? 1 : 0.3,
            }}
          />
        </div>
        <div className="value-display">{displayValue}</div>
      </div>
    </div>
  );
};

// Add MIDI parsing utilities
interface MIDINote {
  note: number;
  velocity: number;
  startTime: number;
  endTime: number;
  channel: number;
}

interface MIDITrack {
  notes: MIDINote[];
  name?: string;
  instrument?: number;
}

interface MIDIFile {
  tracks: MIDITrack[];
  timeDivision: number;
  format: number;
  tempo?: number;
}

// MIDI parsing functions
const parseMIDIFile = (arrayBuffer: ArrayBuffer): MIDIFile => {
  const dataView = new DataView(arrayBuffer);
  let offset = 0;

  // Check MIDI header
  const header = String.fromCharCode(...new Uint8Array(arrayBuffer, 0, 4));
  if (header !== 'MThd') {
    throw new Error('Invalid MIDI file: missing MThd header');
  }

  offset += 4;
  const headerLength = dataView.getUint32(offset);
  offset += 4;
  const format = dataView.getUint16(offset);
  offset += 2;
  const numTracks = dataView.getUint16(offset);
  offset += 2;
  const timeDivision = dataView.getUint16(offset);
  offset += 2;

  const tracks: MIDITrack[] = [];
  let tempo = 120; // Default tempo

  // Parse tracks
  for (let i = 0; i < numTracks; i++) {
    const trackHeader = String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4));
    if (trackHeader !== 'MTrk') {
      throw new Error(`Invalid MIDI file: missing MTrk header at track ${i}`);
    }

    offset += 4;
    const trackLength = dataView.getUint32(offset);
    offset += 4;
    const trackEnd = offset + trackLength;

    const track: MIDITrack = { notes: [] };
    let currentTime = 0;
    let noteOnEvents: Map<number, { time: number; velocity: number }> = new Map();

    while (offset < trackEnd) {
      // Read delta time (variable length quantity)
      let deltaTime = 0;
      let byte;
      do {
        byte = dataView.getUint8(offset++);
        deltaTime = (deltaTime << 7) | (byte & 0x7F);
      } while (byte & 0x80);

      currentTime += deltaTime;

      // Read event type
      const eventType = dataView.getUint8(offset++);
      
      if (eventType === 0xFF) {
        // Meta event
        const metaType = dataView.getUint8(offset++);
        const metaLength = dataView.getUint8(offset++);
        
        if (metaType === 0x03) {
          // Track name
          const nameBytes = new Uint8Array(arrayBuffer, offset, metaLength);
          track.name = new TextDecoder().decode(nameBytes);
        } else if (metaType === 0x51) {
          // Tempo
          const tempoBytes = new Uint8Array(arrayBuffer, offset, metaLength);
          const tempoValue = (tempoBytes[0] << 16) | (tempoBytes[1] << 8) | tempoBytes[2];
          tempo = Math.round(60000000 / tempoValue);
        }
        
        offset += metaLength;
      } else if (eventType === 0xC0) {
        // Program change
        const program = dataView.getUint8(offset++);
        track.instrument = program;
      } else if ((eventType & 0xF0) === 0x90) {
        // Note on
        const note = dataView.getUint8(offset++);
        const velocity = dataView.getUint8(offset++);
        const channel = eventType & 0x0F;
        
        if (velocity > 0) {
          noteOnEvents.set(note, { time: currentTime, velocity });
        } else {
          // Note off (velocity = 0)
          const noteOn = noteOnEvents.get(note);
          if (noteOn) {
            track.notes.push({
              note,
              velocity: noteOn.velocity,
              startTime: noteOn.time,
              endTime: currentTime,
              channel
            });
            noteOnEvents.delete(note);
          }
        }
      } else if ((eventType & 0xF0) === 0x80) {
        // Note off
        const note = dataView.getUint8(offset++);
        const velocity = dataView.getUint8(offset++);
        const channel = eventType & 0x0F;
        
        const noteOn = noteOnEvents.get(note);
        if (noteOn) {
          track.notes.push({
            note,
            velocity: noteOn.velocity,
            startTime: noteOn.time,
            endTime: currentTime,
            channel
          });
          noteOnEvents.delete(note);
        }
      } else {
        // Skip other events
        const dataLength = eventType === 0xF0 || eventType === 0xF7 ? 
          dataView.getUint8(offset++) : 2;
        offset += dataLength;
      }
    }

    // Close any remaining open notes
    noteOnEvents.forEach((noteOn, note) => {
      track.notes.push({
        note,
        velocity: noteOn.velocity,
        startTime: noteOn.time,
        endTime: currentTime,
        channel: 0
      });
    });

    if (track.notes.length > 0) {
      tracks.push(track);
    }
  }

  return { tracks, timeDivision, format, tempo };
};

// Convert MIDI note number to note name and octave
const midiNoteToNote = (midiNote: number): { note: string; octave: number } => {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12) - 1;
  const noteIndex = midiNote % 12;
  return { note: noteNames[noteIndex], octave };
};

// Convert MIDI time to milliseconds
const midiTimeToMs = (midiTime: number, timeDivision: number, tempo: number): number => {
  // Assuming timeDivision is ticks per quarter note
  const ticksPerBeat = timeDivision;
  const msPerBeat = 60000 / tempo; // 60000ms / BPM
  return (midiTime / ticksPerBeat) * msPerBeat;
};

// Add these new components after the WeightSlider component and before the MIDI parsing utilities

// Loading Animation Component
const LoadingAnimation: React.FC = () => {
  return (
    <div className="loading-animation">
      <div className="loading-container">
        <div className="music-notes">
          <div className="note note-1">♪</div>
          <div className="note note-2">♫</div>
          <div className="note note-3">♬</div>
          <div className="note note-4">♪</div>
        </div>
        <div className="loading-text">
          <span>Generating</span>
          <span className="dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>
        <div className="loading-bar">
          <div className="loading-progress"></div>
        </div>
      </div>
    </div>
  );
};

// Music Bars Component
interface MusicBarsProps {
  isPlaying: boolean;
  bpm: number;
}

const MusicBars: React.FC<MusicBarsProps> = ({ isPlaying, bpm }) => {
  const barsCount = 50;
  const beatInterval = 60000 / bpm; // Convert BPM to milliseconds
  
  return (
    <div className={`music-bars ${isPlaying ? 'playing' : ''}`}>
      {Array.from({ length: barsCount }, (_, index) => (
        <div
          key={index}
          className="music-bar"
          style={{
            animationDelay: `${(index * beatInterval) / 8}ms`,
            animationDuration: `${beatInterval}ms`
          }}
        />
      ))}
    </div>
  );
};

const IntegratedMusicPage: React.FC = () => {
  // Piano state
  const [octave, setOctave] = useState(4);
  const [instrument, setInstrument] = useState('piano');
  const [synth, setSynth] = useState<Tone.PolySynth | null>(null);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  const [isRecording, setIsRecording] = useState(false);
  const [recordedNotes, setRecordedNotes] = useState<NoteEvent[]>([]);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [activeNotes, setActiveNotes] = useState<Map<string, { startTime: number; note: string; octave: number }>>(new Map());

  // Metronome state
  const [bpm, setBpm] = useState(120);
  const [isMetronomePlaying, setIsMetronomePlaying] = useState(false);
  const [metronomeSynth, setMetronomeSynth] = useState<Tone.Synth | null>(null);

  // Piano playback state
  const [isPlaybackPlaying, setIsPlaybackPlaying] = useState(false);
  const [playbackSynth, setPlaybackSynth] = useState<Tone.PolySynth | null>(null);
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
  const [playbackStartTime, setPlaybackStartTime] = useState(0);

  // PromptDJ state
  const [prompts, setPrompts] = useState<Map<string, Prompt>>(new Map());
  const [nextPromptId, setNextPromptId] = useState(0);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('stopped');
  const [filteredPrompts, setFilteredPrompts] = useState<Set<string>>(new Set());
  const [connectionError, setConnectionError] = useState(true);
  const [toastMessage, setToastMessage] = useState('');
  const [toastShowing, setToastShowing] = useState(false);
  const [config, setConfig] = useState<LiveMusicGenerationConfig>({
    temperature: 1.1,
    topK: 40,
    guidance: 4.0,
  });

  // Integration state
  const [currentMode, setCurrentMode] = useState<'piano' | 'dj'>('piano');
  const [melodyPrompt, setMelodyPrompt] = useState('');

  // Audio recording state
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);

  // Loading and music bars state
  const [isGenerating, setIsGenerating] = useState(false);

  // Refs
  const sessionRef = useRef<LiveMusicSession | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const playbackStateRef = useRef<PlaybackState>('stopped');
  const bufferTime = 2;

  // Add MIDI import state
  const [importedMIDINotes, setImportedMIDINotes] = useState<NoteEvent[]>([]);
  const [midiFileName, setMidiFileName] = useState<string>('');
  const [isMIDIImported, setIsMIDIImported] = useState(false);

  const instruments = [
    { name: 'piano', label: 'Piano', icon: '🎹' },
    { name: 'synth', label: 'Synth', icon: '🎛️' },
    { name: 'strings', label: 'Strings', icon: '🎻' },
    { name: 'bass', label: 'Bass', icon: '🎸' },
  ];

  const whiteKeys: PianoKey[] = [
    { note: 'C', isBlack: false, keyCode: 'a', displayName: 'A', id: 'C1' },
    { note: 'D', isBlack: false, keyCode: 's', displayName: 'S', id: 'D' },
    { note: 'E', isBlack: false, keyCode: 'd', displayName: 'D', id: 'E' },
    { note: 'F', isBlack: false, keyCode: 'f', displayName: 'F', id: 'F' },
    { note: 'G', isBlack: false, keyCode: 'g', displayName: 'G', id: 'G' },
    { note: 'A', isBlack: false, keyCode: 'h', displayName: 'H', id: 'A' },
    { note: 'B', isBlack: false, keyCode: 'j', displayName: 'J', id: 'B' },
    { note: 'C', isBlack: false, keyCode: 'k', displayName: 'K', id: 'C2' },
  ];

  const blackKeys: PianoKey[] = [
    { note: 'C#', isBlack: true, keyCode: 'w', displayName: 'W', id: 'C#' },
    { note: 'D#', isBlack: true, keyCode: 'e', displayName: 'E', id: 'D#' },
    { note: 'F#', isBlack: true, keyCode: 't', displayName: 'T', id: 'F#' },
    { note: 'G#', isBlack: true, keyCode: 'y', displayName: 'Y', id: 'G#' },
    { note: 'A#', isBlack: true, keyCode: 'u', displayName: 'U', id: 'A#' },
  ];

  // Initialize audio context
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 48000,
    });
    outputNodeRef.current = audioContextRef.current.createGain();
    outputNodeRef.current.connect(audioContextRef.current.destination);
  }, []);

  // Keep the ref in sync with the state
  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  // Initialize piano synth
  const createSynth = useCallback(() => {
    if (synth) {
      synth.dispose();
    }

    let newSynth: Tone.PolySynth;
    switch (instrument) {
      case 'piano':
        newSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { decay: 0.5, sustain: 0.3, release: 1 }
        }).toDestination();
        break;
      case 'synth':
        newSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: { decay: 0.2, sustain: 0.2, release: 0.8 }
        }).toDestination();
        break;
      case 'strings':
        newSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sine' },
          envelope: { decay: 1, sustain: 0.5, release: 2 }
        }).toDestination();
        break;
      case 'bass':
        newSynth = new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'square' },
          envelope: { decay: 0.3, sustain: 0.2, release: 0.5 }
        }).toDestination();
        break;
      default:
        newSynth = new Tone.PolySynth(Tone.Synth).toDestination();
    }
    setSynth(newSynth);
  }, [instrument]);

  useEffect(() => {
    createSynth();
  }, [createSynth]);

  // Initialize playback synth
  useEffect(() => {
    const playback = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { decay: 0.5, sustain: 0.3, release: 1 }
    }).toDestination();
    setPlaybackSynth(playback);

    return () => {
      playback.dispose();
    };
  }, []);

  // Effect to update playback time
  useEffect(() => {
    let animationFrame: number;
    
    const updateTime = () => {
      if (isPlaybackPlaying) {
        const currentTime = Tone.Transport.seconds;
        setCurrentPlaybackTime(currentTime);
        animationFrame = requestAnimationFrame(updateTime);
      }
    };
    
    if (isPlaybackPlaying) {
      updateTime();
    }
    
    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [isPlaybackPlaying]);

  // Metronome functions
  const startMetronome = useCallback(async () => {
    if (!metronomeSynth) return;
    
    await Tone.start();
    Tone.Transport.bpm.value = bpm;
    
    // Schedule metronome clicks
    const click = () => {
      metronomeSynth.triggerAttackRelease('C5', '8n');
    };
    
    Tone.Transport.scheduleRepeat(click, '4n');
    Tone.Transport.start();
    setIsMetronomePlaying(true);
  }, [metronomeSynth, bpm]);

  const stopMetronome = useCallback(() => {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    setIsMetronomePlaying(false);
  }, []);

  // Piano recording functions
  const startRecording = useCallback(() => {
    setRecordedNotes([]);
    setActiveNotes(new Map());
    setRecordingStartTime(Date.now());
    setIsRecording(true);
    // Start the metronome if it's not already playing
    if (!isMetronomePlaying) {
      startMetronome();
    }
  }, [isMetronomePlaying, startMetronome]);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setRecordingStartTime(null);
    setActiveNotes(new Map());
  }, []);

  const recordNoteStart = useCallback((note: string, octave: number) => {
    if (!isRecording || !recordingStartTime) return;
    
    const timestamp = Date.now() - recordingStartTime;
    const noteKey = `${note}${octave}`;
    
    setActiveNotes(prev => new Map(prev.set(noteKey, {
      startTime: timestamp,
      note,
      octave
    })));
  }, [isRecording, recordingStartTime]);

  const recordNoteEnd = useCallback((note: string, octave: number) => {
    if (!isRecording || !recordingStartTime) return;
    
    const noteKey = `${note}${octave}`;
    const activeNote = activeNotes.get(noteKey);
    
    if (activeNote) {
      const endTime = Date.now() - recordingStartTime;
      const duration = endTime - activeNote.startTime;
      
      const noteEvent: NoteEvent = {
        note: activeNote.note,
        octave: activeNote.octave,
        instrument,
        timestamp: activeNote.startTime,
        duration,
        velocity: 0.8
      };
      
      setRecordedNotes(prev => [...prev, noteEvent]);
      setActiveNotes(prev => {
        const newMap = new Map(prev);
        newMap.delete(noteKey);
        return newMap;
      });
    }
  }, [isRecording, recordingStartTime, activeNotes, instrument]);

  // Function to get recorded data
  const getRecordedData = useCallback(() => {
    const currentNotes = isMIDIImported ? importedMIDINotes : recordedNotes;
    return {
      notes: currentNotes,
      metadata: {
        instrument,
        totalDuration: currentNotes.length > 0 
          ? Math.max(...currentNotes.map(n => n.timestamp + n.duration))
          : 0,
        noteCount: currentNotes.length,
        recordingDate: new Date().toISOString(),
        source: isMIDIImported ? 'midi' : 'recording',
        fileName: isMIDIImported ? midiFileName : undefined
      }
    };
  }, [importedMIDINotes, recordedNotes, instrument, isMIDIImported, midiFileName]);

  const getAllNotes = useCallback(() => {
    const currentNotes = isMIDIImported ? importedMIDINotes : recordedNotes;
    const allNotes = new Set<string>();
    currentNotes.forEach(note => {
      allNotes.add(`${note.note}${note.octave}`);
    });
    
    if (allNotes.size === 0) return [];
    
    // Get the range of octaves used
    const octaves = Array.from(allNotes).map(note => {
      const octave = parseInt(note.match(/\d+$/)?.[0] || '0');
      return octave;
    });
    const minOctave = Math.min(...octaves);
    const maxOctave = Math.max(...octaves);
    
    // Create a complete range of notes for the octaves used
    const noteOrder = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const allNotesInRange: string[] = [];
    
    for (let octave = minOctave; octave <= maxOctave; octave++) {
      noteOrder.forEach(note => {
        allNotesInRange.push(`${note}${octave}`);
      });
    }
    
    // Filter to only include notes that were actually played
    return allNotesInRange.filter(note => allNotes.has(note));
  }, [importedMIDINotes, recordedNotes, isMIDIImported]);

  // Function to get all notes in the current range (for grid display)
  const getGridNotes = useCallback(() => {
    const currentNotes = isMIDIImported ? importedMIDINotes : recordedNotes;
    if (currentNotes.length === 0) return [];
    
    // Get the range of notes played
    const allNoteStrings = currentNotes.map(note => `${note.note}${note.octave}`);
    const noteOrder = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    
    // Find the lowest and highest notes played
    let lowestNote = allNoteStrings[0];
    let highestNote = allNoteStrings[0];
    
    allNoteStrings.forEach(noteStr => {
      const note = noteStr.replace(/\d+$/, '');
      const octave = parseInt(noteStr.match(/\d+$/)?.[0] || '0');
      const noteIndex = noteOrder.indexOf(note);
      
      const lowestNoteName = lowestNote.replace(/\d+$/, '');
      const lowestOctave = parseInt(lowestNote.match(/\d+$/)?.[0] || '0');
      const lowestIndex = noteOrder.indexOf(lowestNoteName);
      
      const highestNoteName = highestNote.replace(/\d+$/, '');
      const highestOctave = parseInt(highestNote.match(/\d+$/)?.[0] || '0');
      const highestIndex = noteOrder.indexOf(highestNoteName);
      
      // Compare notes (lower octave or same octave but lower note = lower)
      if (octave < lowestOctave || (octave === lowestOctave && noteIndex < lowestIndex)) {
        lowestNote = noteStr;
      }
      if (octave > highestOctave || (octave === highestOctave && noteIndex > highestIndex)) {
        highestNote = noteStr;
      }
    });
    
    // Parse the lowest and highest notes
    const lowestNoteName = lowestNote.replace(/\d+$/, '');
    const lowestOctave = parseInt(lowestNote.match(/\d+$/)?.[0] || '0');
    const lowestIndex = noteOrder.indexOf(lowestNoteName);
    
    const highestNoteName = highestNote.replace(/\d+$/, '');
    const highestOctave = parseInt(highestNote.match(/\d+$/)?.[0] || '0');
    const highestIndex = noteOrder.indexOf(highestNoteName);
    
    // Calculate the minimum range (full octave + second C)
    const minLowestOctave = lowestOctave;
    const minHighestOctave = lowestOctave + 1;
    const minHighestIndex = 0; // C
    
    // Use the larger range between actual notes played and minimum range
    const startOctave = Math.min(lowestOctave, minLowestOctave);
    const endOctave = Math.max(highestOctave, minHighestOctave);
    const endIndex = Math.max(highestIndex, minHighestIndex);
    
    // Generate all notes in the range
    const allNotesInRange: string[] = [];
    
    for (let octave = startOctave; octave <= endOctave; octave++) {
      const startIndex = (octave === startOctave) ? lowestIndex : 0;
      const endIdx = (octave === endOctave) ? endIndex : 11;
      
      for (let i = startIndex; i <= endIdx; i++) {
        allNotesInRange.push(`${noteOrder[i]}${octave}`);
      }
    }
    
    // Reverse the array so low notes are at the bottom
    return allNotesInRange.reverse();
  }, [importedMIDINotes, recordedNotes, isMIDIImported]);

  // Function to get note color based on instrument
  const getNoteColor = (noteInstrument: string) => {
    switch (noteInstrument) {
      case 'piano': return '#14b8a6';
      case 'synth': return '#8b5cf6';
      case 'strings': return '#f59e0b';
      case 'bass': return '#ef4444';
      default: return '#6b7280';
    }
  };

  // Function to get note position and width for timeline
  const getNoteStyle = (note: NoteEvent, totalDuration: number) => {
    const left = (note.timestamp / totalDuration) * 100;
    const width = (note.duration / totalDuration) * 100;
    return {
      left: `${left}%`,
      width: `${Math.max(width, 1)}%`, // Minimum 1% width for visibility
      backgroundColor: getNoteColor(note.instrument)
    };
  };

  // Initialize metronome synth
  useEffect(() => {
    const metronome = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { decay: 0.1, sustain: 0, release: 0.1 }
    }).toDestination();
    setMetronomeSynth(metronome);

    return () => {
      metronome.dispose();
    };
  }, []);

  const toggleMetronome = useCallback(async () => {
    if (isMetronomePlaying) {
      stopMetronome();
    } else {
      await startMetronome();
    }
  }, [isMetronomePlaying, startMetronome, stopMetronome]);

  const handleBpmChange = useCallback((newBpm: number) => {
    setBpm(newBpm);
    if (isMetronomePlaying) {
      Tone.Transport.bpm.value = newBpm;
    }
  }, [isMetronomePlaying]);

  // Convert recorded notes to melody prompt
  const convertNotesToMelodyPrompt = useCallback(() => {
    const currentNotes = isMIDIImported ? importedMIDINotes : recordedNotes;
    if (currentNotes.length === 0) return '';

    const noteOrder = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    
    // Sort notes by timestamp to maintain order
    const sortedNotes = currentNotes.sort((a, b) => a.timestamp - b.timestamp);
    
    // Analyze musical characteristics
    const totalDuration = Math.max(...sortedNotes.map(n => n.timestamp + n.duration));
    const avgNoteDuration = sortedNotes.reduce((sum, note) => sum + note.duration, 0) / sortedNotes.length;
    const noteDensity = sortedNotes.length / (totalDuration / 1000); // notes per second
    
    // Calculate intervals between consecutive notes
    const intervals: number[] = [];
    for (let i = 1; i < sortedNotes.length; i++) {
      const prevNote = sortedNotes[i - 1];
      const currNote = sortedNotes[i];
      const prevMidi = noteOrder.indexOf(prevNote.note) + (prevNote.octave * 12);
      const currMidi = noteOrder.indexOf(currNote.note) + (currNote.octave * 12);
      intervals.push(currMidi - prevMidi);
    }
    
    // Analyze rhythm patterns
    const timeGaps: number[] = [];
    for (let i = 1; i < sortedNotes.length; i++) {
      const gap = sortedNotes[i].timestamp - (sortedNotes[i - 1].timestamp + sortedNotes[i - 1].duration);
      if (gap > 0) timeGaps.push(gap);
    }
    
    // Create detailed musical analysis
    const melodyAnalysis = {
      noteSequence: sortedNotes.map(note => `${note.note}${note.octave}`).join(' → '),
      timing: sortedNotes.map(note => ({
        note: `${note.note}${note.octave}`,
        start: Math.round(note.timestamp),
        duration: Math.round(note.duration),
        velocity: note.velocity || 0.8
      })),
      rhythm: {
        avgNoteDuration: Math.round(avgNoteDuration),
        noteDensity: Math.round(noteDensity * 10) / 10,
        hasGaps: timeGaps.length > 0,
        avgGap: timeGaps.length > 0 ? Math.round(timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length) : 0
      },
      melody: {
        range: `${Math.min(...sortedNotes.map(n => n.octave))}-${Math.max(...sortedNotes.map(n => n.octave))}`,
        avgInterval: intervals.length > 0 ? Math.round(intervals.reduce((a, b) => a + Math.abs(b), 0) / intervals.length) : 0,
        direction: intervals.length > 0 ? 
          (intervals.filter(i => i > 0).length > intervals.filter(i => i < 0).length ? 'ascending' : 'descending') : 'static'
      }
    };

    // Create a more structured and detailed prompt
    const detailedPrompt = `MUSICAL FOUNDATION FOR AI GENERATION:

PRIMARY MELODY STRUCTURE:
- Exact note sequence: ${melodyAnalysis.noteSequence}
- Total duration: ${Math.round(totalDuration / 1000)} seconds
- Tempo: ${bpm} BPM
- Instrument style: ${instrument}

TIMING AND RHYTHM (CRITICAL - MAINTAIN THESE PATTERNS):
${melodyAnalysis.timing.map(t => `  • ${t.note}: starts at ${t.start}ms, holds for ${t.duration}ms (velocity: ${Math.round(t.velocity * 100)}%)`).join('\n')}

RHYTHMIC CHARACTERISTICS:
- Average note duration: ${melodyAnalysis.rhythm.avgNoteDuration}ms
- Note density: ${melodyAnalysis.rhythm.noteDensity} notes/second
- ${melodyAnalysis.rhythm.hasGaps ? `Pauses between notes: average ${melodyAnalysis.rhythm.avgGap}ms gaps` : 'Continuous playing with no significant pauses'}
- Maintain exact timing relationships between notes

MELODIC CHARACTERISTICS:
- Octave range: ${melodyAnalysis.melody.range}
- Average interval between notes: ${melodyAnalysis.melody.avgInterval} semitones
- Overall direction: ${melodyAnalysis.melody.direction}
- Preserve the melodic contour and note relationships

GENERATION INSTRUCTIONS:
1. Use this exact note sequence as your primary melodic foundation
2. Maintain the precise timing, duration, and velocity of each note
3. Preserve the rhythmic patterns and pauses between notes
4. Keep the same octave range and melodic direction
5. Build accompaniment, harmonies, and variations around this core melody
6. The generated music should feel like an expansion of this melody, not a replacement
7. Maintain the ${instrument} character while adding complementary elements

This melody represents the core musical DNA - all generated content should be built upon and around this foundation while preserving its essential characteristics.`;

    return detailedPrompt;
  }, [importedMIDINotes, recordedNotes, instrument, bpm]);

  // Update melody prompt when recording changes
  useEffect(() => {
    const newMelodyPrompt = convertNotesToMelodyPrompt();
    setMelodyPrompt(newMelodyPrompt);
  }, [convertNotesToMelodyPrompt]);

  // Connect to PromptDJ session
  const connectToSession = useCallback(async () => {
    try {
      console.log('Connecting to session...');
      sessionRef.current = await ai.live.music.connect({
        model: model,
        callbacks: {
          onmessage: async (e: LiveMusicServerMessage) => {
            console.log('Received message from the server:', e);
            if (e.setupComplete) {
              console.log('Setup complete, connection established');
              setConnectionError(false);
            }
            if (e.filteredPrompt && e.filteredPrompt.text) {
              setFilteredPrompts(prev => new Set(Array.from(prev).concat([e.filteredPrompt!.text!])));
              setToastMessage(e.filteredPrompt.filteredReason || 'Prompt filtered');
              setToastShowing(true);
              setTimeout(() => setToastShowing(false), 3000);
            }
            if (e.serverContent?.audioChunks !== undefined) {
              if (playbackStateRef.current === 'paused' || playbackStateRef.current === 'stopped') {
                console.log('Audio chunk received but playback is paused/stopped, skipping');
                return;
              }
              
              const audioData = e.serverContent?.audioChunks[0].data;
              if (!audioData) return;
              
              console.log('Processing audio chunk...');
              
              try {
                if (audioContextRef.current!.state === 'suspended') {
                  await audioContextRef.current!.resume();
                  console.log('Audio context resumed');
                }
                
                const audioBuffer = await decodeAudioData(
                  decode(audioData),
                  audioContextRef.current!,
                  48000,
                  2,
                );
                
                console.log('Audio buffer created, duration:', audioBuffer.duration);
                
                const source = audioContextRef.current!.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputNodeRef.current!);
                
                if (nextStartTimeRef.current === 0) {
                  nextStartTimeRef.current = audioContextRef.current!.currentTime + bufferTime;
                  console.log('First audio chunk, setting start time to:', nextStartTimeRef.current);
                  setTimeout(() => {
                    console.log('Setting playback state to playing');
                    setPlaybackState('playing');
                    setIsGenerating(false);
                  }, bufferTime * 1000);
                }

                if (nextStartTimeRef.current < audioContextRef.current!.currentTime) {
                  console.log('Under run detected, resetting to loading state');
                  setPlaybackState('loading');
                  setIsGenerating(true);
                  nextStartTimeRef.current = 0;
                  return;
                }
                
                console.log('Starting audio source at time:', nextStartTimeRef.current);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                console.log('Next start time will be:', nextStartTimeRef.current);
              } catch (error) {
                console.error('Error processing audio chunk:', error);
                if (error instanceof Error) {
                  console.error('Error details:', error.message);
                }
              }
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('Connection error:', e);
            setConnectionError(true);
            setIsGenerating(false);
            stopAudio();
            setToastMessage('Connection error, please restart audio.');
            setToastShowing(true);
            setTimeout(() => setToastShowing(false), 3000);
          },
          onclose: (e: CloseEvent) => {
            console.log('Connection closed:', e);
            setConnectionError(true);
            setIsGenerating(false);
            stopAudio();
            setToastMessage('Connection error, please restart audio.');
            setToastShowing(true);
            setTimeout(() => setToastShowing(false), 3000);
          },
        },
      });
      console.log('Session connected successfully');
    } catch (error) {
      console.error('Failed to connect to session:', error);
      setConnectionError(true);
      setToastMessage('Failed to connect to session');
      setToastShowing(true);
      setTimeout(() => setToastShowing(false), 3000);
    }
  }, []);

  // Initialize session
  useEffect(() => {
    if (currentMode === 'dj') {
      connectToSession();
    }
  }, [currentMode, connectToSession]);

  // Set session prompts with melody
  const setSessionPrompts = useCallback(
    async () => {
      const promptsToSend = Array.from(prompts.values()).filter((p) => {
        return !filteredPrompts.has(p.text) && p.weight !== 0;
      });

      // Add melody prompt if available
      if (melodyPrompt) {
        promptsToSend.push({
          promptId: 'melody-prompt',
          text: melodyPrompt,
          weight: 1.5, // Higher weight for melody
          color: '#14b8a6',
        });
      }

      try {
        await sessionRef.current?.setWeightedPrompts({
          weightedPrompts: promptsToSend,
        });
      } catch (e: any) {
        setToastMessage(e.message);
        setToastShowing(true);
        setTimeout(() => setToastShowing(false), 3000);
        pauseAudio();
      }
    },
    [prompts, filteredPrompts, melodyPrompt]
  );

  // Update session prompts when prompts or melody changes
  useEffect(() => {
    if (sessionRef.current && currentMode === 'dj') {
      setSessionPrompts();
    }
  }, [prompts, melodyPrompt, setSessionPrompts, currentMode]);

  // Piano note handling
  const playNote = useCallback((note: string, keyCode?: string) => {
    if (synth && currentMode === 'piano') {
      const isFinalC = note === 'C' && keyCode === 'k';
      const actualOctave = isFinalC ? octave + 1 : octave;
      const fullNote = `${note}${actualOctave}`;
      synth.triggerAttack(fullNote);
      recordNoteStart(note, actualOctave);
    }
  }, [synth, octave, recordNoteStart, currentMode]);

  const stopNote = useCallback((note: string, keyCode?: string) => {
    if (synth && currentMode === 'piano') {
      const isFinalC = note === 'C' && keyCode === 'k';
      const actualOctave = isFinalC ? octave + 1 : octave;
      const fullNote = `${note}${actualOctave}`;
      synth.triggerRelease(fullNote);
      recordNoteEnd(note, actualOctave);
    }
  }, [synth, octave, recordNoteEnd, currentMode]);

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    if (currentMode !== 'piano') return;
    
    const key = event.key.toLowerCase();
    
    if (key === 'z') {
      setOctave(prev => Math.max(1, prev - 1));
      return;
    }
    if (key === 'x') {
      setOctave(prev => Math.min(7, prev + 1));
      return;
    }

    const allKeys = [...whiteKeys, ...blackKeys];
    const pianoKey = allKeys.find(k => k.keyCode === key);
    
    if (pianoKey && !pressedKeys.has(pianoKey.id)) {
      setPressedKeys(prev => new Set(Array.from(prev).concat(pianoKey.id)));
      playNote(pianoKey.note, pianoKey.keyCode);
    }
  }, [pressedKeys, playNote, currentMode]);

  const handleKeyRelease = useCallback((event: KeyboardEvent) => {
    if (currentMode !== 'piano') return;
    
    const key = event.key.toLowerCase();
    const allKeys = [...whiteKeys, ...blackKeys];
    const pianoKey = allKeys.find(k => k.keyCode === key);
    
    if (pianoKey) {
      setPressedKeys(prev => {
        const newSet = new Set(Array.from(prev));
        newSet.delete(pianoKey.id);
        return newSet;
      });
      stopNote(pianoKey.note, pianoKey.keyCode);
    }
  }, [stopNote, currentMode]);

  const handleMouseDown = (note: string, keyCode: string, keyId: string) => {
    if (currentMode !== 'piano') return;
    
    if (!pressedKeys.has(keyId)) {
      setPressedKeys(prev => new Set(Array.from(prev).concat(keyId)));
      playNote(note, keyCode);
    }
  };

  const handleMouseUp = (note: string, keyCode: string, keyId: string) => {
    if (currentMode !== 'piano') return;
    
    setPressedKeys(prev => {
      const newSet = new Set(Array.from(prev));
      newSet.delete(keyId);
      return newSet;
    });
    stopNote(note, keyCode);
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyPress);
    document.addEventListener('keyup', handleKeyRelease);
    
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
      document.removeEventListener('keyup', handleKeyRelease);
    };
  }, [handleKeyPress, handleKeyRelease]);

  // Piano playback functions
  const pausePlayback = useCallback(() => {
    if (isPlaybackPlaying) {
      Tone.Transport.pause();
      setIsPlaybackPlaying(false);
      setPlaybackStartTime(Tone.Transport.seconds);
      
      // Release all notes when pausing
      if (playbackSynth) {
        playbackSynth.releaseAll();
      }
    }
  }, [isPlaybackPlaying, playbackSynth]);

  const resumePlayback = useCallback(() => {
    if (!isPlaybackPlaying && recordedNotes.length > 0) {
      Tone.Transport.start();
      setIsPlaybackPlaying(true);
    }
  }, [isPlaybackPlaying, recordedNotes.length]);

  const stopPlayback = useCallback(() => {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    setIsPlaybackPlaying(false);
    setCurrentPlaybackTime(0);
    setPlaybackStartTime(0);
    
    // Release all notes
    if (playbackSynth) {
      playbackSynth.releaseAll();
    }
  }, [playbackSynth]);

  const startPlayback = useCallback(async () => {
    const currentNotes = isMIDIImported ? importedMIDINotes : recordedNotes;
    if (!playbackSynth || currentNotes.length === 0) return;

    await Tone.start();
    
    // Stop any current playback
    stopPlayback();
    
    // Reset playback time
    setCurrentPlaybackTime(0);
    setPlaybackStartTime(0);
    
    // Schedule all notes
    currentNotes.forEach((noteEvent) => {
      const note = `${noteEvent.note}${noteEvent.octave}`;
      const startTime = noteEvent.timestamp / 1000; // Convert to seconds
      const duration = noteEvent.duration / 1000; // Convert to seconds
      
      // Schedule note start
      Tone.Transport.schedule((time) => {
        playbackSynth.triggerAttack(note, time);
      }, startTime);
      
      // Schedule note end
      Tone.Transport.schedule((time) => {
        playbackSynth.triggerRelease(note, time);
      }, startTime + duration);
    });
    
    // Set transport to the total duration
    const totalDuration = Math.max(...currentNotes.map(n => n.timestamp + n.duration)) / 1000;
    
    // Start transport
    Tone.Transport.start();
    setIsPlaybackPlaying(true);
    
    // Stop when playback is complete
    Tone.Transport.schedule(() => {
      stopPlayback();
    }, totalDuration);
    
  }, [playbackSynth, isMIDIImported, importedMIDINotes, recordedNotes, stopPlayback]);

  const restartPlayback = useCallback(async () => {
    await startPlayback();
  }, [startPlayback]);

  const togglePlayback = useCallback(async () => {
    if (isPlaybackPlaying) {
      pausePlayback();
    } else {
      if (currentPlaybackTime > 0) {
        resumePlayback();
      } else {
        await startPlayback();
      }
    }
  }, [isPlaybackPlaying, currentPlaybackTime, pausePlayback, resumePlayback, startPlayback]);

  // Audio recording functions (move these BEFORE the audio control functions)
  const startAudioRecording = useCallback(async () => {
    try {
      if (!audioContextRef.current) return;

      // Create a MediaStreamDestination to capture audio
      const destination = audioContextRef.current.createMediaStreamDestination();
      
      // Connect the output node to the destination
      if (outputNodeRef.current) {
        outputNodeRef.current.connect(destination);
      }

      // Create MediaRecorder
      const recorder = new MediaRecorder(destination.stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      const chunks: Blob[] = [];
      
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setRecordedAudioBlob(blob);
        setAudioChunks(chunks);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecordingAudio(true);
      
      setToastMessage('Started recording AI music...');
      setToastShowing(true);
      setTimeout(() => setToastShowing(false), 2000);
    } catch (error) {
      console.error('Error starting audio recording:', error);
      setToastMessage('Failed to start recording');
      setToastShowing(true);
      setTimeout(() => setToastShowing(false), 3000);
    }
  }, []);

  const stopAudioRecording = useCallback(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      setIsRecordingAudio(false);
      setToastMessage('Recording stopped. Ready to download.');
      setToastShowing(true);
      setTimeout(() => setToastShowing(false), 3000);
    }
  }, [mediaRecorder]);

  const downloadAudio = useCallback(() => {
    if (!recordedAudioBlob) {
      setToastMessage('No recorded audio to download');
      setToastShowing(true);
      setTimeout(() => setToastShowing(false), 3000);
      return;
    }

    try {
      // Convert to MP3-like format (WebM with Opus codec is actually better quality)
      const url = URL.createObjectURL(recordedAudioBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-music-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      setToastMessage('Audio downloaded successfully!');
      setToastShowing(true);
      setTimeout(() => setToastShowing(false), 3000);
    } catch (error) {
      console.error('Error downloading audio:', error);
      setToastMessage('Failed to download audio');
      setToastShowing(true);
      setTimeout(() => setToastShowing(false), 3000);
    }
  }, [recordedAudioBlob]);

  const clearRecordedAudio = useCallback(() => {
    setRecordedAudioBlob(null);
    setAudioChunks([]);
    if (mediaRecorder) {
      mediaRecorder.stop();
    }
    setMediaRecorder(null);
    setIsRecordingAudio(false);
  }, [mediaRecorder]);

  // PromptDJ audio control functions (now these can use the recording functions)
  const pauseAudio = useCallback(() => {
    sessionRef.current?.pause();
    setPlaybackState('paused');
    nextStartTimeRef.current = 0;
    if (outputNodeRef.current && audioContextRef.current) {
      outputNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
    }
    // Auto-stop recording when audio pauses
    if (isRecordingAudio) {
      stopAudioRecording();
    }
  }, [isRecordingAudio, stopAudioRecording]);

  const loadAudio = useCallback(() => {
    console.log('Loading audio...');
    setIsGenerating(true);
    
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().then(() => {
        console.log('Audio context resumed in loadAudio');
        sessionRef.current?.play();
        setPlaybackState('loading');
        if (outputNodeRef.current && audioContextRef.current) {
          outputNodeRef.current.gain.setValueAtTime(1, audioContextRef.current.currentTime);
        }
        // Auto-start recording when audio starts - reduced delay
        setTimeout(() => {
          console.log('Checking if should auto-start recording...');
          console.log('Playback state:', playbackState);
          console.log('Is recording audio:', isRecordingAudio);
          if (playbackState === 'playing' && !isRecordingAudio) {
            console.log('Auto-starting recording...');
            startAudioRecording();
          }
        }, bufferTime * 1000 + 300); // Reduced from 1000ms to 300ms
      });
    } else {
      sessionRef.current?.play();
      setPlaybackState('loading');
      if (outputNodeRef.current && audioContextRef.current) {
        outputNodeRef.current.gain.setValueAtTime(1, audioContextRef.current.currentTime);
      }
      // Auto-start recording when audio starts - reduced delay
      setTimeout(() => {
        console.log('Checking if should auto-start recording...');
        console.log('Playback state:', playbackState);
        console.log('Is recording audio:', isRecordingAudio);
        if (playbackState === 'playing' && !isRecordingAudio) {
          console.log('Auto-starting recording...');
          startAudioRecording();
        }
      }, bufferTime * 1000 + 300); // Reduced from 1000ms to 300ms
    }
  }, [isRecordingAudio, startAudioRecording, playbackState]);

  // Add an effect to auto-start recording when playback state changes to 'playing'
  useEffect(() => {
    if (playbackState === 'playing' && !isRecordingAudio && currentMode === 'dj') {
      console.log('Playback state changed to playing, auto-starting recording...');
      // Reduced delay to start recording earlier
      const timer = setTimeout(() => {
        if (playbackState === 'playing' && !isRecordingAudio) {
          startAudioRecording();
        }
      }, 800); // Reduced from 2000ms to 800ms
      
      return () => clearTimeout(timer);
    }
  }, [playbackState, isRecordingAudio, currentMode, startAudioRecording]);

  const stopAudio = useCallback(() => {
    sessionRef.current?.stop();
    setPlaybackState('stopped');
    setIsGenerating(false);
    nextStartTimeRef.current = 0;
    if (outputNodeRef.current && audioContextRef.current) {
      outputNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
    }
    // Auto-stop recording when audio stops
    if (isRecordingAudio) {
      stopAudioRecording();
    }
  }, [isRecordingAudio, stopAudioRecording]);

  const handlePlayPause = useCallback(async () => {
    console.log('handlePlayPause called, current state:', playbackState);
    
    if (playbackState === 'playing') {
      pauseAudio();
    } else if (playbackState === 'paused' || playbackState === 'stopped') {
      if (connectionError) {
        await connectToSession();
        setSessionPrompts();
      }
      loadAudio();
    } else if (playbackState === 'loading') {
      stopAudio();
    }
  }, [playbackState, connectionError, connectToSession, setSessionPrompts, loadAudio, pauseAudio, stopAudio]);

  // Prompt management
  const handlePromptChanged = useCallback((prompt: Prompt) => {
    setPrompts(prev => {
      const newPrompts = new Map(prev);
      newPrompts.set(prompt.promptId, prompt);
      return newPrompts;
    });
  }, []);

  const handlePromptRemoved = useCallback((promptId: string) => {
    setPrompts(prev => {
      const newPrompts = new Map(prev);
      newPrompts.delete(promptId);
      return newPrompts;
    });
  }, []);

  const handleAddPrompt = useCallback(() => {
    const newPromptId = `prompt-${nextPromptId}`;
    const usedColors = Array.from(prompts.values()).map((p) => p.color);
    const newPrompt: Prompt = {
      promptId: newPromptId,
      text: 'New Prompt',
      weight: 0,
      color: getUnusedRandomColor(usedColors),
    };
    
    setPrompts(prev => {
      const newPrompts = new Map(prev);
      newPrompts.set(newPromptId, newPrompt);
      return newPrompts;
    });
    setNextPromptId(prev => prev + 1);
  }, [nextPromptId, prompts]);

  const handleReset = useCallback(async () => {
    // First stop any current audio and recording
    stopAudio();
    
    if (connectionError) {
      await connectToSession();
      setSessionPrompts();
    }
    
    // Reset the session context
    sessionRef.current?.resetContext();
    setConfig({
      temperature: 1.1,
      topK: 40,
      guidance: 4.0,
    });
    sessionRef.current?.setMusicGenerationConfig({
      musicGenerationConfig: {},
    });
    
    // Wait a bit before starting new audio to ensure clean state
    setTimeout(() => {
      if (playbackState === 'stopped') {
        loadAudio();
      }
    }, 200);
  }, [connectionError, connectToSession, setSessionPrompts, stopAudio, loadAudio, playbackState]);

  const updateSettings = useCallback(
    async (newConfig: LiveMusicGenerationConfig) => {
      await sessionRef.current?.setMusicGenerationConfig({
        musicGenerationConfig: newConfig,
      });
    },
    []
  );

  const handleSettingsChanged = useCallback((newConfig: LiveMusicGenerationConfig) => {
    setConfig(newConfig);
    updateSettings(newConfig);
  }, [updateSettings]);

  // Utility functions
  const getUnusedRandomColor = (usedColors: string[]): string => {
    const COLORS = [
      '#9900ff', '#5200ff', '#ff25f6', '#2af6de', '#ffdd28', '#3dffab', '#d8ff3e', '#d9b2ff',
    ];
    const availableColors = COLORS.filter((c) => !usedColors.includes(c));
    if (availableColors.length === 0) {
      return COLORS[Math.floor(Math.random() * COLORS.length)];
    }
    return availableColors[Math.floor(Math.random() * availableColors.length)];
  };

  // MIDI import functions
  const handleMIDIFileImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const midiFile = parseMIDIFile(arrayBuffer);
        
        // Convert MIDI notes to NoteEvent format
        const convertedNotes: NoteEvent[] = [];
        const tempo = midiFile.tempo || 120;
        
        midiFile.tracks.forEach((track, trackIndex) => {
          track.notes.forEach((midiNote) => {
            const { note, octave } = midiNoteToNote(midiNote.note);
            const startTime = midiTimeToMs(midiNote.startTime, midiFile.timeDivision, tempo);
            const endTime = midiTimeToMs(midiNote.endTime, midiFile.timeDivision, tempo);
            const duration = endTime - startTime;
            
            convertedNotes.push({
              note,
              octave,
              instrument: 'piano', // Default to piano, could be enhanced to map MIDI instruments
              timestamp: startTime,
              duration,
              velocity: midiNote.velocity / 127 // Normalize velocity to 0-1
            });
          });
        });

        // Sort notes by timestamp
        convertedNotes.sort((a, b) => a.timestamp - b.timestamp);
        
        setImportedMIDINotes(convertedNotes);
        setMidiFileName(file.name);
        setIsMIDIImported(true);
        
        // Update BPM if MIDI file has tempo information
        if (midiFile.tempo) {
          setBpm(midiFile.tempo);
        }
        
        setToastMessage(`MIDI file "${file.name}" imported successfully!`);
        setToastShowing(true);
        setTimeout(() => setToastShowing(false), 3000);
        
      } catch (error) {
        console.error('Error parsing MIDI file:', error);
        setToastMessage('Failed to parse MIDI file');
        setToastShowing(true);
        setTimeout(() => setToastShowing(false), 3000);
      }
    };
    
    reader.readAsArrayBuffer(file);
  }, []);

  const clearMIDIImport = useCallback(() => {
    setImportedMIDINotes([]);
    setMidiFileName('');
    setIsMIDIImported(false);
  }, []);

  // Use imported MIDI notes instead of recorded notes when available
  const getCurrentNotes = useCallback(() => {
    return isMIDIImported ? importedMIDINotes : recordedNotes;
  }, [isMIDIImported, importedMIDINotes, recordedNotes]);

  return (
    <div className="integrated-music-page">
      <motion.div
        className="integrated-container"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="header">
          <Link to="/" className="back-button">
            <motion.div
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
            >
              ← Back to Home
            </motion.div>
          </Link>
          <div className="branding">
            <h1>BeatMind</h1>
            <p className="tagline">AI-Powered Music Studio</p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="mode-toggle">
          <motion.button
            className={`mode-btn ${currentMode === 'piano' ? 'active' : ''}`}
            onClick={() => {
              if (currentMode !== 'piano') {
                window.location.reload();
              }
              setCurrentMode('piano');
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            🎹 Piano Mode
          </motion.button>
          <motion.button
            className={`mode-btn ${currentMode === 'dj' ? 'active' : ''}`}
            onClick={() => {
              stopMetronome();
              setCurrentMode('dj');
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            🎛️ AI DJ Mode
          </motion.button>
        </div>

        {/* Piano Mode */}
        {currentMode === 'piano' && (
          <motion.div
            className="piano-section"
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="piano-controls">
              <div className="control-group">
                <label>Metronome:</label>
                <div className="metronome-controls">
                  <div className="bpm-control">
                    <input
                      type="range"
                      min="60"
                      max="200"
                      value={bpm}
                      onChange={(e) => handleBpmChange(parseInt(e.target.value))}
                      className="bpm-slider"
                    />
                    <input
                      type="number"
                      min="60"
                      max="200"
                      value={bpm}
                      onChange={(e) => handleBpmChange(parseInt(e.target.value) || 120)}
                      className="bpm-input"
                    />
                  </div>
                  <motion.button
                    className={`metronome-btn ${isMetronomePlaying ? 'active' : ''}`}
                    onClick={toggleMetronome}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {isMetronomePlaying ? '⏸️ Stop Metronome' : '🎵 Start Metronome'}
                  </motion.button>
                </div>
              </div>

              <div className="control-group">
                <label>Octave: {octave}</label>
                <div className="octave-controls">
                  <motion.button
                    className="octave-btn"
                    onClick={() => setOctave(prev => Math.max(1, prev - 1))}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    Z (Lower)
                  </motion.button>
                  <motion.button
                    className="octave-btn"
                    onClick={() => setOctave(prev => Math.min(7, prev + 1))}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    X (Higher)
                  </motion.button>
                </div>
              </div>

              <div className="control-group">
                <label>MIDI Import:</label>
                <div className="midi-import-controls">
                  <input
                    type="file"
                    accept=".mid,.midi"
                    onChange={handleMIDIFileImport}
                    className="midi-file-input"
                    id="midi-file-input"
                  />
                  <label htmlFor="midi-file-input" className="midi-import-btn">
                    📁 Import MIDI File
                  </label>
                  
                  {isMIDIImported && (
                    <div className="midi-info">
                      <span>Loaded: {midiFileName}</span>
                      <motion.button
                        className="clear-midi-btn"
                        onClick={clearMIDIImport}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        🗑️ Clear MIDI
                      </motion.button>
                    </div>
                  )}
                </div>
              </div>

              <div className="control-group">
                <label>Recording:</label>
                <div className="recording-controls">
                  <motion.button
                    className={`recording-btn ${isRecording ? 'active' : ''}`}
                    onClick={isRecording ? stopRecording : startRecording}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    {isRecording ? '⏹️ Stop Recording' : '🔴 Start Recording'}
                  </motion.button>
                  
                  {recordedNotes.length > 0 && (
                    <div className="recording-info">
                      <span>Notes recorded: {recordedNotes.length}</span>
                      <motion.button
                        className="clear-btn"
                        onClick={() => setRecordedNotes([])}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                      >
                        🗑️ Clear
                      </motion.button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="piano">
              <div className="white-keys">
                {whiteKeys.map((key) => (
                  <motion.div
                    key={key.id}
                    className={`white-key ${pressedKeys.has(key.id) ? 'pressed' : ''}`}
                    onMouseDown={() => handleMouseDown(key.note, key.keyCode, key.id)}
                    onMouseUp={() => handleMouseUp(key.note, key.keyCode, key.id)}
                    onMouseLeave={() => handleMouseUp(key.note, key.keyCode, key.id)}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <div className="key-label">{key.displayName}</div>
                    <div className="note-label">{key.note}</div>
                  </motion.div>
                ))}
              </div>
              
              <div className="black-keys">
                {blackKeys.map((key, index) => {
                  const positions = [0.5, 1.5, 3.5, 4.5, 5.5];
                  const leftPosition = `${(positions[index] / 8) * 100+3}%`;
                  
                  return (
                    <motion.div
                      key={key.id}
                      className={`black-key ${pressedKeys.has(key.id) ? 'pressed' : ''}`}
                      style={{ left: leftPosition }}
                      onMouseDown={() => handleMouseDown(key.note, key.keyCode, key.id)}
                      onMouseUp={() => handleMouseUp(key.note, key.keyCode, key.id)}
                      onMouseLeave={() => handleMouseUp(key.note, key.keyCode, key.id)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <div className="key-label">{key.displayName}</div>
                      <div className="note-label">{key.note}</div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Recording Visualization */}
            
            {(getCurrentNotes().length > 0) && (
              <motion.div
                className="recording-visualization"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                <h3>{isMIDIImported ? 'MIDI File View' : 'Piano Roll View'}</h3>
                
                {/* Playback Controls */}
                <div className="playback-controls">
                  <div className="playback-buttons">
                    <motion.button
                      className="playback-btn restart-btn"
                      onClick={restartPlayback}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      disabled={getCurrentNotes().length === 0}
                      title="Restart Playback"
                    >
                      🔄 Restart
                    </motion.button>
                    
                    <motion.button
                      className={`playback-btn ${isPlaybackPlaying ? 'pause-btn' : 'play-btn'}`}
                      onClick={togglePlayback}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      disabled={getCurrentNotes().length === 0}
                      title={isPlaybackPlaying ? 'Pause Playback' : 'Play/Pause Recording'}
                    >
                      {isPlaybackPlaying ? '⏸️ Pause' : '▶️ Play'}
                    </motion.button>
                    
                    <motion.button
                      className="playback-btn stop-btn"
                      onClick={stopPlayback}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      disabled={!isPlaybackPlaying && currentPlaybackTime === 0}
                      title="Stop Playback"
                    >
                      ⏹️ Stop
                    </motion.button>
                  </div>
                  
                  {(isPlaybackPlaying || currentPlaybackTime > 0) && (
                    <div className="playback-progress">
                      <div className="progress-bar">
                        <motion.div
                          className="progress-fill"
                          initial={{ width: 0 }}
                          animate={{ 
                            width: `${(currentPlaybackTime / (getRecordedData().metadata.totalDuration / 1000)) * 100}%` 
                          }}
                          transition={{ duration: 0.1 }}
                        />
                      </div>
                      <span className="progress-time">
                        {Math.round(currentPlaybackTime)}s / {Math.round(getRecordedData().metadata.totalDuration / 1000)}s
                      </span>
                    </div>
                  )}
                </div>

                <div className="piano-roll-container">
                  <div className="piano-roll-header">
                    <div className="time-labels">
                      <span>0s</span>
                      <span>{Math.round(getRecordedData().metadata.totalDuration / 1000)}s</span>
                    </div>
                  </div>
                  
                  <div className="piano-roll">
                    <div className="note-labels">
                      {getGridNotes().map((noteName) => {
                        const wasPlayed = getCurrentNotes().some(note => `${note.note}${note.octave}` === noteName);
                        return (
                          <div 
                            key={noteName} 
                            className={`note-label ${wasPlayed ? 'played' : 'unplayed'}`}
                          >
                            {noteName}
                          </div>
                        );
                      })}
                    </div>
                    
                    <div className="note-grid">
                      {/* Playback indicator bar */}
                      {(isPlaybackPlaying || currentPlaybackTime > 0) && (
                        <div
                          className="playback-indicator"
                          style={{
                            left: `${(currentPlaybackTime / (getRecordedData().metadata.totalDuration / 1000)) * 100}%`
                          }}
                        />
                      )}
                      
                      {getGridNotes().map((noteName) => (
                        <div key={noteName} className="note-row">
                          {getCurrentNotes()
                            .filter(note => `${note.note}${note.octave}` === noteName)
                            .map((note, index) => {
                              const totalDuration = getRecordedData().metadata.totalDuration;
                              const noteStyle = getNoteStyle(note, totalDuration);
                              
                              return (
                                <motion.div
                                  key={`${noteName}-${index}`}
                                  className="note-block"
                                  style={noteStyle}
                                  initial={{ opacity: 0, scale: 0.8 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  transition={{ duration: 0.3, delay: index * 0.05 }}
                                  title={`${note.note}${note.octave} - ${note.instrument} (${Math.round(note.duration)}ms)`}
                                />
                              );
                            })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="recording-stats">
                  <div className="stat">
                    <span className="stat-label">Total Notes:</span>
                    <span className="stat-value">{getCurrentNotes().length}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Duration:</span>
                    <span className="stat-value">{Math.round(getRecordedData().metadata.totalDuration / 1000)}s</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Unique Notes:</span>
                    <span className="stat-value">{getAllNotes().length}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Octave Range:</span>
                    <span className="stat-value">
                      {getCurrentNotes().length > 0 
                        ? `${Math.min(...getCurrentNotes().map(n => n.octave))}-${Math.max(...getCurrentNotes().map(n => n.octave))}`
                        : 'N/A'
                      }
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Source:</span>
                    <span className="stat-value">{isMIDIImported ? 'MIDI File' : 'Recording'}</span>
                  </div>
                  {isMIDIImported && (
                    <div className="stat">
                      <span className="stat-label">File:</span>
                      <span className="stat-value">{midiFileName}</span>
                    </div>
                  )}
                </div>

                <div className="legend">
                  <h4>Legend:</h4>
                  <div className="legend-items">
                    {instruments.map((inst) => (
                      <div key={inst.name} className="legend-item">
                        <div 
                          className="legend-color" 
                          style={{ backgroundColor: getNoteColor(inst.name) }}
                        />
                        <span>{inst.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

          </motion.div>
        )}

        {/* Melody Preview */}
        {melodyPrompt && currentMode === 'piano' && (
          <motion.div
            className="melody-preview"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="melody-actions">
              <motion.button
                className="use-melody-btn"
                onClick={() => {
                  stopMetronome();
                  setCurrentMode('dj');
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
                🎛️ Switch to AI DJ Mode
              </motion.button>
            </div>
          </motion.div>
        )}

        {/* AI DJ Mode */}
        {currentMode === 'dj' && (
          <motion.div
            className="dj-section"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="prompts-area">
              <div className="prompts-container">
                {Array.from(prompts.values()).map((prompt) => (
                  <div key={prompt.promptId} className="prompt">
                    <button
                      className="remove-button"
                      onClick={() => handlePromptRemoved(prompt.promptId)}
                    >
                      ×
                    </button>
                    <WeightSlider
                      value={prompt.weight}
                      color={prompt.color}
                      onChange={(newWeight) => handlePromptChanged({
                        ...prompt,
                        weight: newWeight
                      })}
                    />
                    <div className="prompt-controls">
                      <textarea
                        className="text-input"
                        value={prompt.text}
                        onChange={(e) => handlePromptChanged({
                          ...prompt,
                          text: e.target.value
                        })}
                        placeholder="Enter prompt..."
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="add-prompt-button-container">
                <button className="add-prompt-btn" onClick={handleAddPrompt}>
                  +
                </button>
              </div>
            </div>

            {/* Melody Integration Display */}
            {melodyPrompt && (
              <motion.div
                className="melody-integration"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                <h3>🎹 Piano Melody Integration</h3>
                <div className="melody-info">
                  <p>Your recorded piano melody is being used as the foundation for AI music generation.</p>
                  <div className="melody-stats">
                    <span>Notes: {getCurrentNotes().length}</span>
                    <span>Duration: {Math.round(Math.max(...getCurrentNotes().map(n => n.timestamp + n.duration)) / 1000)}s</span>
                  </div>
                </div>
              </motion.div>
            )}

            <div className="dj-controls">
              <motion.button
                className={`play-btn ${playbackState === 'playing' ? 'playing' : ''}`}
                onClick={handlePlayPause}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {playbackState === 'playing' ? '⏸️ Pause' : '▶️ Play'}
              </motion.button>
              <motion.button
                className="reset-btn"
                onClick={handleReset}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                🔄 Reset
              </motion.button>
            </div>

            {/* Audio Recording Controls */}
            <div className="audio-recording-controls">
              <h3>🎤 Record AI Music</h3>
              <div className="recording-buttons">
                {!isRecordingAudio ? (
                  <motion.button
                    className="record-btn"
                    onClick={startAudioRecording}
                    disabled={playbackState !== 'playing'}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    title="Start recording AI-generated music (auto-starts when playing)"
                  >
                    🔴 Start Recording
                  </motion.button>
                ) : (
                  <motion.button
                    className="stop-record-btn"
                    onClick={stopAudioRecording}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    title="Stop recording"
                  >
                    ⏹️ Stop Recording
                  </motion.button>
                )}
                
                {recordedAudioBlob && (
                  <>
                    <motion.button
                      className="download-btn"
                      onClick={downloadAudio}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      title="Download recorded audio as MP3"
                    >
                      💾 Download MP3
                    </motion.button>
                    <motion.button
                      className="clear-audio-btn"
                      onClick={clearRecordedAudio}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      title="Clear recorded audio"
                    >
                      🗑️ Clear
                    </motion.button>
                  </>
                )}
              </div>
              
              {isRecordingAudio && (
                <div className="recording-status">
                  <div className="recording-indicator">
                    <div className="pulse-dot"></div>
                    Recording AI music...
                  </div>
                </div>
              )}
              
              {recordedAudioBlob && (
                <div className="recording-info">
                  <p>✅ Audio recorded successfully! Click "Download MP3" to save your AI-generated music.</p>
                </div>
              )}
              
              <div className="auto-record-info">
                <p>💡 Recording automatically starts when you play AI music and stops when you pause/stop.</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Toast Message */}
        {toastShowing && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
          >
            {toastMessage}
            <button onClick={() => setToastShowing(false)}>×</button>
          </motion.div>
        )}

        {/* Loading Animation */}
        {isGenerating && (
          <LoadingAnimation />
        )}
      </motion.div>
    </div>
  );
};

export default IntegratedMusicPage; 