/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string): Uint8Array {
  console.log('Decoding base64 string, length:', base64.length);
  const binaryString = atob(base64);
  console.log('Binary string length:', binaryString.length);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  console.log('Decoded bytes length:', bytes.length);
  console.log('First few bytes:', Array.from(bytes.slice(0, 10)));
  return bytes;
}

function createBlob(data: Float32Array): { data: string; mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // convert float32 -1 to 1 to int16 -32768 to 32767
    int16[i] = data[i] * 32768;
  }

  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  console.log('Decoding audio data:', {
    dataLength: data.length,
    sampleRate,
    numChannels,
    expectedSamples: data.length / 2 / numChannels
  });
  
  const buffer = ctx.createBuffer(
    numChannels,
    data.length / 2 / numChannels,
    sampleRate,
  );

  // Create Int16Array from the Uint8Array data
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
  const l = dataInt16.length;
  const dataFloat32 = new Float32Array(l);
  
  for (let i = 0; i < l; i++) {
    dataFloat32[i] = dataInt16[i] / 32768.0;
  }
  
  console.log('Converted audio data:', {
    int16Length: dataInt16.length,
    float32Length: dataFloat32.length,
    bufferLength: buffer.length,
    bufferDuration: buffer.duration
  });
  
  // For stereo audio (2 channels), we need to deinterleave the data
  if (numChannels === 2) {
    const leftChannel = new Float32Array(l / 2);
    const rightChannel = new Float32Array(l / 2);
    
    for (let i = 0; i < l; i += 2) {
      leftChannel[i / 2] = dataFloat32[i];
      rightChannel[i / 2] = dataFloat32[i + 1];
    }
    
    buffer.copyToChannel(leftChannel, 0);
    buffer.copyToChannel(rightChannel, 1);
  } else {
    // Mono audio
    buffer.copyToChannel(dataFloat32, 0);
  }

  return buffer;
}

export { createBlob, decode, decodeAudioData, encode };
