import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { motion } from 'framer-motion';
import LandingPage from './components/LandingPage';
import PianoPage from './components/PianoPage';
import PromptDJ from './components/PromptDJ';
import IntegratedMusicPage from './components/IntegratedMusicPage';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/piano" element={<PianoPage />} />
          <Route path="/DJ" element={<PromptDJ />} />
          <Route path="/integrated" element={<IntegratedMusicPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App; 