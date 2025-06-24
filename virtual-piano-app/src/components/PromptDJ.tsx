/**
 * @fileoverview Control real time music with text prompts
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  GoogleGenAI,
  type LiveMusicGenerationConfig,
  type LiveMusicServerMessage,
  type LiveMusicSession,
} from '@google/genai';
import { decode, decodeAudioData } from '../utils';
import './PromptDJ.css';

const ai = new GoogleGenAI({
  apiKey: process.env.REACT_APP_GEMINI_API_KEY,
  apiVersion: 'v1alpha',
});
let model = 'lyria-realtime-exp';

interface Prompt {
  readonly promptId: string;
  readonly color: string;
  text: string;
  weight: number;
}

type PlaybackState = 'stopped' | 'playing' | 'loading' | 'paused';

/** Throttles a callback to be called at most once per `freq` milliseconds. */
function throttle(func: (...args: unknown[]) => void, delay: number) {
  let lastCall = 0;
  return (...args: unknown[]) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    if (timeSinceLastCall >= delay) {
      func(...args);
      lastCall = now;
    }
  };
}

const PROMPT_TEXT_PRESETS = [
  'Bossa Nova',
  'Minimal Techno',
  'Drum and Bass',
  'Post Punk',
  'Shoegaze',
  'Funk',
  'Chiptune',
  'Lush Strings',
  'Sparkling Arpeggios',
  'Staccato Rhythms',
  'Punchy Kick',
  'Dubstep',
  'K Pop',
  'Neo Soul',
  'Trip Hop',
  'Thrash',
];

const COLORS = [
  '#9900ff',
  '#5200ff',
  '#ff25f6',
  '#2af6de',
  '#ffdd28',
  '#3dffab',
  '#d8ff3e',
  '#d9b2ff',
];

function getUnusedRandomColor(usedColors: string[]): string {
  const availableColors = COLORS.filter((c) => !usedColors.includes(c));
  if (availableColors.length === 0) {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }
  return availableColors[Math.floor(Math.random() * availableColors.length)];
}

// WeightSlider component
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

// Icon Button components
interface IconButtonProps {
  onClick?: () => void;
  children?: React.ReactNode;
}

const IconButton: React.FC<IconButtonProps> = ({ onClick, children }) => {
  return (
    <div className="icon-button" onClick={onClick}>
      <svg
      width="140"
      height="140"
      viewBox="0 -10 140 150"
      fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
      <rect
        x="22"
        y="6"
        width="96"
        height="96"
        rx="48"
        fill="black"
          fillOpacity="0.05"
        />
      <rect
        x="23.5"
        y="7.5"
        width="93"
        height="93"
        rx="46.5"
        stroke="black"
          strokeOpacity="0.3"
          strokeWidth="3"
        />
      <g filter="url(#filter0_ddi_1048_7373)">
        <rect
          x="25"
          y="9"
          width="90"
          height="90"
          rx="45"
          fill="white"
            fillOpacity="0.05"
            shapeRendering="crispEdges"
          />
      </g>
        {children}
      <defs>
        <filter
          id="filter0_ddi_1048_7373"
          x="0"
          y="0"
          width="140"
          height="140"
          filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
          <feOffset dy="2" />
          <feGaussianBlur stdDeviation="4" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"
            />
          <feBlend
            mode="normal"
            in2="BackgroundImageFix"
              result="effect1_dropShadow_1048_7373"
            />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
          <feOffset dy="16" />
          <feGaussianBlur stdDeviation="12.5" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"
            />
          <feBlend
            mode="normal"
            in2="effect1_dropShadow_1048_7373"
              result="effect2_dropShadow_1048_7373"
            />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="effect2_dropShadow_1048_7373"
              result="shape"
            />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              result="hardAlpha"
            />
          <feOffset dy="3" />
          <feGaussianBlur stdDeviation="1.5" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix
            type="matrix"
              values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.05 0"
            />
          <feBlend
            mode="normal"
            in2="shape"
              result="effect3_innerShadow_1048_7373"
            />
        </filter>
      </defs>
      </svg>
      <div className="hitbox" />
    </div>
  );
};

// PlayPauseButton component
interface PlayPauseButtonProps {
  playbackState: PlaybackState;
  onClick: () => void;
}

const PlayPauseButton: React.FC<PlayPauseButtonProps> = ({ playbackState, onClick }) => {
  const renderIcon = () => {
    if (playbackState === 'playing') {
      return (
        <path
      d="M75.0037 69V39H83.7537V69H75.0037ZM56.2537 69V39H65.0037V69H56.2537Z"
      fill="#FEFEFE"
        />
      );
    } else if (playbackState === 'loading') {
      return (
        <path
          shapeRendering="crispEdges"
          className="loader"
          d="M70,74.2L70,74.2c-10.7,0-19.5-8.7-19.5-19.5l0,0c0-10.7,8.7-19.5,19.5-19.5
                l0,0c10.7,0,19.5,8.7,19.5,19.5l0,0"
        />
      );
    } else {
      return <path d="M60 71.5V36.5L87.5 54L60 71.5Z" fill="#FEFEFE" />;
    }
  };

  return (
    <IconButton onClick={onClick}>
      {renderIcon()}
    </IconButton>
  );
};

// ResetButton component
const ResetButton: React.FC<IconButtonProps> = ({ onClick }) => {
  return (
    <IconButton onClick={onClick}>
      <path
        fill="#fefefe"
        d="M71,77.1c-2.9,0-5.7-0.6-8.3-1.7s-4.8-2.6-6.7-4.5c-1.9-1.9-3.4-4.1-4.5-6.7c-1.1-2.6-1.7-5.3-1.7-8.3h4.7
      c0,4.6,1.6,8.5,4.8,11.7s7.1,4.8,11.7,4.8c4.6,0,8.5-1.6,11.7-4.8c3.2-3.2,4.8-7.1,4.8-11.7s-1.6-8.5-4.8-11.7
      c-3.2-3.2-7.1-4.8-11.7-4.8h-0.4l3.7,3.7L71,46.4L61.5,37l9.4-9.4l3.3,3.4l-3.7,3.7H71c2.9,0,5.7,0.6,8.3,1.7
      c2.6,1.1,4.8,2.6,6.7,4.5c1.9,1.9,3.4,4.1,4.5,6.7c1.1,2.6,1.7,5.3,1.7,8.3c0,2.9-0.6,5.7-1.7,8.3c-1.1,2.6-2.6,4.8-4.5,6.7
          s-4.1,3.4-6.7,4.5C76.7,76.5,73.9,77.1,71,77.1z"
      />
    </IconButton>
  );
};

// AddPromptButton component
const AddPromptButton: React.FC<IconButtonProps> = ({ onClick }) => {
  return (
    <IconButton onClick={onClick}>
      <path d="M67 40 H73 V52 H85 V58 H73 V70 H67 V58 H55 V52 H67 Z" fill="#FEFEFE" />
    </IconButton>
  );
};

// Toast Message component
interface ToastMessageProps {
  message: string;
  showing: boolean;
  onHide: () => void;
}

const ToastMessage: React.FC<ToastMessageProps> = ({ message, showing, onHide }) => {
  return (
    <div className={`toast ${showing ? 'showing' : ''}`}>
      <div className="message">{message}</div>
      <button onClick={onHide}>✕</button>
    </div>
  );
};

// Prompt Controller component
interface PromptControllerProps {
  promptId: string;
  text: string;
  weight: number;
  color: string;
  filtered: boolean;
  onPromptChanged: (prompt: Prompt) => void;
  onPromptRemoved: (promptId: string) => void;
}

const PromptController: React.FC<PromptControllerProps> = ({
  promptId,
  text,
  weight,
  color,
  filtered,
  onPromptChanged,
  onPromptRemoved,
}) => {
  const [editingText, setEditingText] = useState(text);
  const textRef = useRef<HTMLSpanElement>(null);

  const handleTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      updateText();
      textRef.current?.blur();
    }
  };

  const updateText = () => {
    const newText = editingText.trim();
    if (newText === '') {
      setEditingText(text);
      return;
    }
    onPromptChanged({
      promptId,
      text: newText,
      weight,
      color,
    });
  };

  const updateWeight = (newWeight: number) => {
    onPromptChanged({
      promptId,
      text,
      weight: newWeight,
      color,
    });
  };

  const handleRemove = () => {
    onPromptRemoved(promptId);
  };

  return (
    <div className={`prompt ${filtered ? 'filtered' : ''}`}>
      <button className="remove-button" onClick={handleRemove}>×</button>
      <WeightSlider
        value={weight}
        color={color}
        onChange={updateWeight}
      />
      <div className="controls">
        <span
          ref={textRef}
          className="text-input"
          contentEditable
          suppressContentEditableWarning
          onKeyDown={handleTextKeyDown}
          onBlur={updateText}
          onInput={(e) => setEditingText(e.currentTarget.textContent || '')}
        >
          {text}
        </span>
      </div>
    </div>
  );
};

// Settings Controller component
interface SettingsControllerProps {
  config: LiveMusicGenerationConfig;
  onSettingsChanged: (config: LiveMusicGenerationConfig) => void;
}

const SettingsController: React.FC<SettingsControllerProps> = ({ config, onSettingsChanged }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [autoDensity, setAutoDensity] = useState(true);
  const [lastDefinedDensity, setLastDefinedDensity] = useState<number>(0.5);
  const [autoBrightness, setAutoBrightness] = useState(true);
  const [lastDefinedBrightness, setLastDefinedBrightness] = useState<number>(0.5);

  const defaultConfig = {
    temperature: 1.1,
    topK: 40,
    guidance: 4.0,
  };

  const resetToDefaults = () => {
    onSettingsChanged(defaultConfig);
    setAutoDensity(true);
    setLastDefinedDensity(0.5);
    setAutoBrightness(true);
    setLastDefinedBrightness(0.5);
  };

  const handleInputChange = (key: keyof LiveMusicGenerationConfig | 'auto-density' | 'auto-brightness', value: any) => {
    const newConfig = { ...config, [key]: value };

    if (newConfig.density !== undefined) {
      setLastDefinedDensity(newConfig.density);
    }

    if (newConfig.brightness !== undefined) {
      setLastDefinedBrightness(newConfig.brightness);
    }

    if (key === 'auto-density') {
      setAutoDensity(Boolean(value));
      newConfig.density = Boolean(value) ? undefined : lastDefinedDensity;
    } else if (key === 'auto-brightness') {
      setAutoBrightness(Boolean(value));
      newConfig.brightness = Boolean(value) ? undefined : lastDefinedBrightness;
    }

    onSettingsChanged(newConfig);
  };

    const scaleMap = new Map<string, string>([
      ['Auto', 'SCALE_UNSPECIFIED'],
      ['C Major / A Minor', 'C_MAJOR_A_MINOR'],
      ['C# Major / A# Minor', 'D_FLAT_MAJOR_B_FLAT_MINOR'],
      ['D Major / B Minor', 'D_MAJOR_B_MINOR'],
      ['D# Major / C Minor', 'E_FLAT_MAJOR_C_MINOR'],
      ['E Major / C# Minor', 'E_MAJOR_D_FLAT_MINOR'],
      ['F Major / D Minor', 'F_MAJOR_D_MINOR'],
      ['F# Major / D# Minor', 'G_FLAT_MAJOR_E_FLAT_MINOR'],
      ['G Major / E Minor', 'G_MAJOR_E_MINOR'],
      ['G# Major / F Minor', 'A_FLAT_MAJOR_F_MINOR'],
      ['A Major / F# Minor', 'A_MAJOR_G_FLAT_MINOR'],
      ['A# Major / G Minor', 'B_FLAT_MAJOR_G_MINOR'],
      ['B Major / G# Minor', 'B_MAJOR_A_FLAT_MINOR'],
    ]);

  return (
    <div className={`settings-controller ${showAdvanced ? 'showadvanced' : ''}`}>
      <div className="core-settings-row">
        <div className="setting">
          <label htmlFor="temperature">
            Temperature<span>{config.temperature?.toFixed(1)}</span>
          </label>
          <input
            type="range"
            id="temperature"
            min="0"
            max="3"
            step="0.1"
            value={config.temperature?.toString() || '1.1'}
            onChange={(e) => handleInputChange('temperature', Number(e.target.value))}
          />
        </div>
        <div className="setting">
          <label htmlFor="guidance">
            Guidance<span>{config.guidance?.toFixed(1)}</span>
          </label>
          <input
            type="range"
            id="guidance"
            min="0"
            max="6"
            step="0.1"
            value={config.guidance?.toString() || '4.0'}
            onChange={(e) => handleInputChange('guidance', Number(e.target.value))}
          />
        </div>
        <div className="setting">
          <label htmlFor="topK">Top K<span>{config.topK}</span></label>
          <input
            type="range"
            id="topK"
            min="1"
            max="100"
            step="1"
            value={config.topK?.toString() || '40'}
            onChange={(e) => handleInputChange('topK', Number(e.target.value))}
          />
        </div>
      </div>
      <hr className="divider" />
      <div className={`advanced-settings ${showAdvanced ? 'visible' : ''}`}>
        <div className="setting">
          <label htmlFor="seed">Seed</label>
          <input
            type="number"
            id="seed"
            value={config.seed ?? ''}
            onChange={(e) => handleInputChange('seed', e.target.value === '' ? undefined : Number(e.target.value))}
            placeholder="Auto"
          />
        </div>
        <div className="setting">
          <label htmlFor="bpm">BPM</label>
          <input
            type="number"
            id="bpm"
            min="60"
            max="180"
            value={config.bpm ?? ''}
            onChange={(e) => handleInputChange('bpm', e.target.value === '' ? undefined : Number(e.target.value))}
            placeholder="Auto"
          />
        </div>
        <div className={`setting ${autoDensity ? 'auto' : ''}`}>
          <label htmlFor="density">Density</label>
          <input
            type="range"
            id="density"
            min="0"
            max="1"
            step="0.05"
            value={lastDefinedDensity}
            onChange={(e) => handleInputChange('density', Number(e.target.value))}
            disabled={autoDensity}
          />
          <div className="auto-row">
            <input
              type="checkbox"
              id="auto-density"
              checked={autoDensity}
              onChange={(e) => handleInputChange('auto-density', e.target.checked)}
            />
            <label htmlFor="auto-density">Auto</label>
            <span>{lastDefinedDensity.toFixed(2)}</span>
          </div>
        </div>
        <div className={`setting ${autoBrightness ? 'auto' : ''}`}>
          <label htmlFor="brightness">Brightness</label>
          <input
            type="range"
            id="brightness"
            min="0"
            max="1"
            step="0.05"
            value={lastDefinedBrightness}
            onChange={(e) => handleInputChange('brightness', Number(e.target.value))}
            disabled={autoBrightness}
          />
          <div className="auto-row">
            <input
              type="checkbox"
              id="auto-brightness"
              checked={autoBrightness}
              onChange={(e) => handleInputChange('auto-brightness', e.target.checked)}
            />
            <label htmlFor="auto-brightness">Auto</label>
            <span>{lastDefinedBrightness.toFixed(2)}</span>
          </div>
        </div>
        <div className="setting">
          <label htmlFor="scale">Scale</label>
          <select
            id="scale"
            value={config.scale || 'SCALE_UNSPECIFIED'}
            onChange={(e) => handleInputChange('scale', e.target.value)}
          >
            {Array.from(scaleMap.entries()).map(([displayName, enumValue]) => (
              <option key={enumValue} value={enumValue}>
                {displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="setting">
          <div className="setting checkbox-setting">
            <input
              type="checkbox"
              id="muteBass"
              checked={!!config.muteBass}
              onChange={(e) => handleInputChange('muteBass', e.target.checked)}
            />
            <label htmlFor="muteBass" style={{ fontWeight: 'normal' }}>
              Mute Bass
            </label>
          </div>
          <div className="setting checkbox-setting">
            <input
              type="checkbox"
              id="muteDrums"
              checked={!!config.muteDrums}
              onChange={(e) => handleInputChange('muteDrums', e.target.checked)}
            />
            <label htmlFor="muteDrums" style={{ fontWeight: 'normal' }}>
              Mute Drums
            </label>
          </div>
          <div className="setting checkbox-setting">
            <input
              type="checkbox"
              id="onlyBassAndDrums"
              checked={!!config.onlyBassAndDrums}
              onChange={(e) => handleInputChange('onlyBassAndDrums', e.target.checked)}
            />
            <label htmlFor="onlyBassAndDrums" style={{ fontWeight: 'normal' }}>
              Only Bass & Drums
            </label>
          </div>
        </div>
      </div>
      <div className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
      </div>
    </div>
  );
};

// Main PromptDJ component
const PromptDJ: React.FC = () => {
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

  const sessionRef = useRef<LiveMusicSession | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef(0);
  const playbackStateRef = useRef<PlaybackState>('stopped');
  const bufferTime = 2;

  // Keep the ref in sync with the state
  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  // Initialize audio context
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 48000,
    });
    outputNodeRef.current = audioContextRef.current.createGain();
    outputNodeRef.current.connect(audioContextRef.current.destination);
  }, []);

  // Load initial prompts
  useEffect(() => {
    const initialPrompts = getStoredPrompts();
    setPrompts(initialPrompts);
    setNextPromptId(initialPrompts.size);
  }, []);

  // Connect to session
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
              // Use the ref instead of the stale closure value
              if (playbackStateRef.current === 'paused' || playbackStateRef.current === 'stopped') {
                console.log('Audio chunk received but playback is paused/stopped, skipping');
                return;
              }
              
              const audioData = e.serverContent?.audioChunks[0].data;
              if (!audioData) return;
              
              console.log('Processing audio chunk...');
              
              try {
                // Ensure audio context is running
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
                  }, bufferTime * 1000);
                }

                if (nextStartTimeRef.current < audioContextRef.current!.currentTime) {
                  console.log('Under run detected, resetting to loading state');
                  setPlaybackState('loading');
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
            stopAudio();
            setToastMessage('Connection error, please restart audio.');
            setToastShowing(true);
            setTimeout(() => setToastShowing(false), 3000);
          },
          onclose: (e: CloseEvent) => {
            console.log('Connection closed:', e);
            setConnectionError(true);
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
    connectToSession();
  }, [connectToSession]);

  const setSessionPrompts = useCallback(
    throttle(async () => {
      const promptsToSend = Array.from(prompts.values()).filter((p) => {
        return !filteredPrompts.has(p.text) && p.weight !== 0;
    });
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
    }, 200),
    [prompts, filteredPrompts]
  );

  // Update session prompts when prompts change
  useEffect(() => {
    if (sessionRef.current) {
      setSessionPrompts();
    }
  }, [prompts, setSessionPrompts]);

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

  const makeBackground = useCallback(() => {
    const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
    const MAX_WEIGHT = 0.5;
    const MAX_ALPHA = 0.6;
    const bg: string[] = [];

    Array.from(prompts.values()).forEach((p, i) => {
      const alphaPct = clamp01(p.weight / MAX_WEIGHT) * MAX_ALPHA;
      const alpha = Math.round(alphaPct * 0xff).toString(16).padStart(2, '0');
      const stop = p.weight / 2;
      const x = (i % 4) / 3;
      const y = Math.floor(i / 4) / 3;
      const s = `radial-gradient(circle at ${x * 100}% ${y * 100}%, ${p.color}${alpha} 0px, ${p.color}00 ${stop * 100}%)`;
      bg.push(s);
    });

    return bg.join(', ');
  }, [prompts]);

  const pauseAudio = useCallback(() => {
    sessionRef.current?.pause();
    setPlaybackState('paused');
    nextStartTimeRef.current = 0; // Reset timing
    if (outputNodeRef.current && audioContextRef.current) {
      outputNodeRef.current.gain.setValueAtTime(1, audioContextRef.current.currentTime);
      outputNodeRef.current.gain.linearRampToValueAtTime(0, audioContextRef.current.currentTime + 0.1);
    }
    // Don't recreate the output node here - this might be causing issues
  }, []);

  const loadAudio = useCallback(() => {
    console.log('Loading audio...');
    // Ensure audio context is resumed before starting
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().then(() => {
        console.log('Audio context resumed in loadAudio');
        sessionRef.current?.play();
        setPlaybackState('loading');
        if (outputNodeRef.current && audioContextRef.current) {
          outputNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
          outputNodeRef.current.gain.linearRampToValueAtTime(1, audioContextRef.current.currentTime + 0.1);
        }
      });
    } else {
      sessionRef.current?.play();
      setPlaybackState('loading');
      if (outputNodeRef.current && audioContextRef.current) {
        outputNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
        outputNodeRef.current.gain.linearRampToValueAtTime(1, audioContextRef.current.currentTime + 0.1);
      }
    }
  }, []);

  const stopAudio = useCallback(() => {
    sessionRef.current?.stop();
    setPlaybackState('stopped');
    nextStartTimeRef.current = 0; // Reset timing
    if (outputNodeRef.current && audioContextRef.current) {
      outputNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
      outputNodeRef.current.gain.linearRampToValueAtTime(1, audioContextRef.current.currentTime + 0.1);
    }
  }, []);

  const handlePlayPause = useCallback(async () => {
    console.log('handlePlayPause called, current state:', playbackState);
    console.log('Audio context state:', audioContextRef.current?.state);
    
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

  const handleAddPrompt = useCallback(async () => {
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
    if (connectionError) {
      await connectToSession();
      setSessionPrompts();
    }
    pauseAudio();
    sessionRef.current?.resetContext();
    setConfig({
      temperature: 1.1,
      topK: 40,
      guidance: 4.0,
    });
    sessionRef.current?.setMusicGenerationConfig({
      musicGenerationConfig: {},
    });
    setTimeout(loadAudio, 100);
  }, [connectionError, connectToSession, setSessionPrompts, pauseAudio, loadAudio]);

  const updateSettings = useCallback(
    throttle(async (...args: unknown[]) => {
      const newConfig = args[0] as LiveMusicGenerationConfig;
      await sessionRef.current?.setMusicGenerationConfig({
        musicGenerationConfig: newConfig,
      });
    }, 200),
    []
  );

  const handleSettingsChanged = useCallback((newConfig: LiveMusicGenerationConfig) => {
    setConfig(newConfig);
    updateSettings(newConfig);
  }, [updateSettings]);

  // Save prompts to localStorage
  useEffect(() => {
    setStoredPrompts(prompts);
  }, [prompts]);

  const bg = makeBackground();

  return (
    <div className="prompt-dj">
      <div className="background" style={{ backgroundImage: bg }} />
      <div className="prompts-area">
        <div className="prompts-container">
          {Array.from(prompts.values()).map((prompt) => (
            <PromptController
              key={prompt.promptId}
              promptId={prompt.promptId}
              filtered={filteredPrompts.has(prompt.text)}
              text={prompt.text}
              weight={prompt.weight}
              color={prompt.color}
              onPromptChanged={handlePromptChanged}
              onPromptRemoved={handlePromptRemoved}
            />
          ))}
        </div>
        <div className="add-prompt-button-container">
          <AddPromptButton onClick={handleAddPrompt} />
        </div>
      </div>
      <div className="settings-container">
        <SettingsController
          config={config}
          onSettingsChanged={handleSettingsChanged}
        />
      </div>
      <div className="playback-container">
        <PlayPauseButton
          playbackState={playbackState}
          onClick={handlePlayPause}
        />
        <ResetButton onClick={handleReset} />
      </div>
      <ToastMessage
        message={toastMessage}
        showing={toastShowing}
        onHide={() => setToastShowing(false)}
      />
    </div>
  );
};

// Utility functions
function getStoredPrompts(): Map<string, Prompt> {
  const { localStorage } = window;
  const storedPrompts = localStorage.getItem('prompts');

  if (storedPrompts) {
    try {
      const prompts = JSON.parse(storedPrompts) as Prompt[];
      console.log('Loading stored prompts', prompts);
      return new Map(prompts.map((prompt) => [prompt.promptId, prompt]));
    } catch (e) {
      console.error('Failed to parse stored prompts', e);
    }
  }

  console.log('No stored prompts, creating prompt presets');

  const numDefaultPrompts = Math.min(4, PROMPT_TEXT_PRESETS.length);
  const shuffledPresetTexts = [...PROMPT_TEXT_PRESETS].sort(() => Math.random() - 0.5);
  const defaultPrompts: Prompt[] = [];
  const usedColors: string[] = [];
  
  for (let i = 0; i < numDefaultPrompts; i++) {
    const text = shuffledPresetTexts[i];
    const color = getUnusedRandomColor(usedColors);
    usedColors.push(color);
    defaultPrompts.push({
      promptId: `prompt-${i}`,
      text,
      weight: 0,
      color,
    });
  }
  
  const promptsToActivate = [...defaultPrompts].sort(() => Math.random() - 0.5);
  const numToActivate = Math.min(2, defaultPrompts.length);
  for (let i = 0; i < numToActivate; i++) {
    if (promptsToActivate[i]) {
      promptsToActivate[i].weight = 1;
    }
  }
  return new Map(defaultPrompts.map((p) => [p.promptId, p]));
}

function setStoredPrompts(prompts: Map<string, Prompt>) {
  const storedPrompts = JSON.stringify(Array.from(prompts.values()));
  const { localStorage } = window;
  localStorage.setItem('prompts', storedPrompts);
}

// Main App component
function App() {
  return (
    <div className="App">
      <PromptDJ />
    </div>
  );
}

export default App;

