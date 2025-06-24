import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import * as Tone from 'tone';
import './PianoPage.css';

interface PianoKey {
  note: string;
  isBlack: boolean;
  keyCode: string;
  displayName: string;
  id: string; // Unique identifier for each key
}

interface NoteEvent {
  note: string;
  octave: number;
  instrument: string;
  timestamp: number;
  duration: number;
  velocity?: number; // For future MIDI support
}

const PianoPage: React.FC = () => {
  const [octave, setOctave] = useState(4);
  const [instrument, setInstrument] = useState('piano');
  const [synth, setSynth] = useState<Tone.PolySynth | null>(null);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  
  // Metronome state
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [tempo, setTempo] = useState(120);
  const [metronomeSynth, setMetronomeSynth] = useState<Tone.Synth | null>(null);
  const [beatCount, setBeatCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordedNotes, setRecordedNotes] = useState<NoteEvent[]>([]);
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
  const [activeNotes, setActiveNotes] = useState<Map<string, { startTime: number; note: string; octave: number }>>(new Map());

  // Playback state
  const [isPlaybackPlaying, setIsPlaybackPlaying] = useState(false);
  const [playbackSynth, setPlaybackSynth] = useState<Tone.PolySynth | null>(null);
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0);
  const [playbackStartTime, setPlaybackStartTime] = useState(0);

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

  // Initialize metronome synth
  useEffect(() => {
    const metronome = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 }
    }).toDestination();
    
    // Set the metronome volume to -20dB (much quieter)
    metronome.volume.value = 1.5;
    
    setMetronomeSynth(metronome);

    return () => {
      metronome.dispose();
    };
  }, []);

  // Metronome functionality
  const startMetronome = useCallback(async () => {
    if (!metronomeSynth) return;

    await Tone.start();
    Tone.Transport.bpm.value = tempo;
    
    // Clear any existing events
    Tone.Transport.cancel();
    
    // Create a repeating pattern for the metronome
    const pattern = new Tone.Pattern((time, step) => {
      // Strong beat on first beat, weak beat on others
      const frequency = step === 0 ? 800 : 600;
      
      metronomeSynth.triggerAttackRelease(frequency, '8n', time);
      setBeatCount(step);
    }, [0, 1, 2, 3], 'up');

    pattern.start(0);
    Tone.Transport.start();
    setIsPlaying(true);
  }, [metronomeSynth, tempo]);

  const stopMetronome = useCallback(() => {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    setIsPlaying(false);
    setBeatCount(0);
  }, []);

  const toggleMetronome = useCallback(async () => {
    if (isPlaying) {
      stopMetronome();
    } else {
      await startMetronome();
    }
  }, [isPlaying, startMetronome, stopMetronome]);

  // Update tempo when it changes
  useEffect(() => {
    if (isPlaying) {
      Tone.Transport.bpm.value = tempo;
    }
  }, [tempo, isPlaying]);

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

  // Recording functions
  const startRecording = useCallback(() => {
    setRecordedNotes([]);
    setActiveNotes(new Map());
    setRecordingStartTime(Date.now());
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setRecordingStartTime(null);
    // Clear any active notes that weren't released
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
        velocity: 0.8 // Default velocity
      };
      
      setRecordedNotes(prev => [...prev, noteEvent]);
      setActiveNotes(prev => {
        const newMap = new Map(prev);
        newMap.delete(noteKey);
        return newMap;
      });
    }
  }, [isRecording, recordingStartTime, activeNotes, instrument]);

  // Function to get recorded data (for backend)
  const getRecordedData = useCallback(() => {
    return {
      notes: recordedNotes,
      metadata: {
        instrument,
        tempo,
        totalDuration: recordedNotes.length > 0 
          ? Math.max(...recordedNotes.map(n => n.timestamp + n.duration))
          : 0,
        noteCount: recordedNotes.length,
        recordingDate: new Date().toISOString()
      }
    };
  }, [recordedNotes, instrument, tempo]);

  // Function to get all unique notes from recording with proper octave handling
  const getAllNotes = useCallback(() => {
    const allNotes = new Set<string>();
    recordedNotes.forEach(note => {
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
  }, [recordedNotes]);

  // Function to get all notes in the current range (for grid display)
  const getGridNotes = useCallback(() => {
    if (recordedNotes.length === 0) return [];
    
    // Get the range of notes played
    const allNoteStrings = recordedNotes.map(note => `${note.note}${note.octave}`);
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
  }, [recordedNotes]);

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

  // Function to check if note is black key
  const isBlackKey = (noteName: string) => {
    return noteName.includes('#');
  };

  const playNote = useCallback((note: string, keyCode?: string) => {
    if (synth) {
      // For the final C (K key), use the next octave
      const isFinalC = note === 'C' && keyCode === 'k';
      const actualOctave = isFinalC ? octave + 1 : octave;
      const fullNote = `${note}${actualOctave}`;
      synth.triggerAttack(fullNote);
      
      // Record the note start
      recordNoteStart(note, actualOctave);
    }
  }, [synth, octave, recordNoteStart]);

  const stopNote = useCallback((note: string, keyCode?: string) => {
    if (synth) {
      // For the final C (K key), use the next octave
      const isFinalC = note === 'C' && keyCode === 'k';
      const actualOctave = isFinalC ? octave + 1 : octave;
      const fullNote = `${note}${actualOctave}`;
      synth.triggerRelease(fullNote);
      
      // Record the note end
      recordNoteEnd(note, actualOctave);
    }
  }, [synth, octave, recordNoteEnd]);

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
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
  }, [pressedKeys, playNote]);

  const handleKeyRelease = useCallback((event: KeyboardEvent) => {
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
  }, [stopNote]);

  const handleMouseDown = (note: string, keyCode: string, keyId: string) => {
    if (!pressedKeys.has(keyId)) {
      setPressedKeys(prev => new Set(Array.from(prev).concat(keyId)));
      playNote(note, keyCode);
    }
  };

  const handleMouseUp = (note: string, keyCode: string, keyId: string) => {
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

  // Playback functions
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
    if (!playbackSynth || recordedNotes.length === 0) return;

    await Tone.start();
    
    // Stop any current playback
    stopPlayback();
    
    // Reset playback time
    setCurrentPlaybackTime(0);
    setPlaybackStartTime(0);
    
    // Schedule all notes
    recordedNotes.forEach((noteEvent) => {
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
    const totalDuration = Math.max(...recordedNotes.map(n => n.timestamp + n.duration)) / 1000;
    
    // Start transport
    Tone.Transport.start();
    setIsPlaybackPlaying(true);
    
    // Stop when playback is complete
    Tone.Transport.schedule(() => {
      stopPlayback();
    }, totalDuration);
    
  }, [playbackSynth, recordedNotes, stopPlayback]);

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

  return (
    <div className="piano-page">
      <motion.div
        className="piano-container"
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
          <h1>Virtual Piano</h1>
        </div>

        <div className="controls">
          <div className="control-group">
            <label>Instrument:</label>
            <div className="instrument-selector">
              {instruments.map((inst) => (
                <motion.button
                  key={inst.name}
                  className={`instrument-btn ${instrument === inst.name ? 'active' : ''}`}
                  onClick={() => setInstrument(inst.name)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <span className="instrument-icon">{inst.icon}</span>
                  {inst.label}
                </motion.button>
              ))}
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

          {/* Recording Controls */}
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

          {/* Metronome Controls */}
          <div className="control-group">
            <label>Metronome:</label>
            <div className="metronome-controls">
              <motion.button
                className={`metronome-btn ${isPlaying ? 'active' : ''}`}
                onClick={toggleMetronome}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                {isPlaying ? '⏸️ Stop' : '▶️ Start'}
              </motion.button>
              
              <div className="tempo-control">
                <label>Tempo: {tempo} BPM</label>
                <input
                  type="range"
                  min="60"
                  max="200"
                  value={tempo}
                  onChange={(e) => setTempo(Number(e.target.value))}
                  className="tempo-slider"
                />
              </div>
            </div>
            
            {/* Visual beat indicator */}
            {isPlaying && (
              <div className="beat-indicator">
                {[0, 1, 2, 3].map((beat) => (
                  <motion.div
                    key={beat}
                    className={`beat-dot ${beatCount === beat ? 'active' : ''}`}
                    animate={beatCount === beat ? { scale: [1, 1.5, 1] } : {}}
                    transition={{ duration: 0.1 }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>



        <div className="piano">
          <div className="white-keys">
            {whiteKeys.map((key) => (
              <motion.div
                key={key.id}
                className={`white-key ${pressedKeys.has(key.id) ? 'pressed' : ''}`}
                onMouseDown={(event) => handleMouseDown(key.note, key.keyCode, key.id)}
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
                  style={{
                    left: leftPosition,
                  }}
                  onMouseDown={(event) => handleMouseDown(key.note, key.keyCode, key.id)}
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
        {recordedNotes.length > 0 && (
          <motion.div
            className="recording-visualization"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <h3>Piano Roll View</h3>
            
            {/* Playback Controls */}
            <div className="playback-controls">
              <div className="playback-buttons">
                <motion.button
                  className="playback-btn restart-btn"
                  onClick={restartPlayback}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={recordedNotes.length === 0}
                  title="Restart Playback"
                >
                  🔄 Restart
                </motion.button>
                
                <motion.button
                  className={`playback-btn ${isPlaybackPlaying ? 'pause-btn' : 'play-btn'}`}
                  onClick={togglePlayback}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={recordedNotes.length === 0}
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
                    const wasPlayed = recordedNotes.some(note => `${note.note}${note.octave}` === noteName);
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
                      {recordedNotes
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
                <span className="stat-value">{recordedNotes.length}</span>
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
                  {recordedNotes.length > 0 
                    ? `${Math.min(...recordedNotes.map(n => n.octave))}-${Math.max(...recordedNotes.map(n => n.octave))}`
                    : 'N/A'
                  }
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">Instrument:</span>
                <span className="stat-value">{instrument}</span>
              </div>
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

        <div className="instructions">
          <h3>How to Play:</h3>
          <ul>
            <li>Click on the piano keys or use your computer keyboard</li>
            <li>White keys: A, S, D, F, G, H, J, K</li>
            <li>Black keys: W, E, T, Y, U</li>
            <li>Z: Lower octave, X: Higher octave</li>
            <li>Switch instruments using the buttons above</li>
            <li>Use the metronome to keep time while playing</li>
            <li>Record your performance for later analysis</li>
          </ul>
        </div>
      </motion.div>
    </div>
  );
};

export default PianoPage; 