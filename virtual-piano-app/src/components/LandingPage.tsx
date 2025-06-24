import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import './LandingPage.css';

const LandingPage: React.FC = () => {
  return (
    <div className="landing-page">
      <div className="background-animation">
        <motion.div
          className="floating-circle"
          animate={{
            y: [0, -20, 0],
            x: [0, 10, 0],
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <motion.div
          className="floating-circle"
          style={{ left: '20%', top: '60%' }}
          animate={{
            y: [0, 30, 0],
            x: [0, -15, 0],
          }}
          transition={{
            duration: 6,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <motion.div
          className="floating-circle"
          style={{ right: '15%', top: '30%' }}
          animate={{
            y: [0, -25, 0],
            x: [0, 20, 0],
          }}
          transition={{
            duration: 5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <motion.div
          className="floating-circle"
          style={{ right: '20%', top: '10%' }}
          animate={{
            y: [0, -25, 0],
            x: [0, 20, 0],
          }}
          transition={{
            duration: 5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
      </div>

      <motion.div
        className="content"
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 }}
      >
        <motion.h1
          className="title"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          BeatMind
        </motion.h1>
        
        <motion.p
          className="subtitle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.5 }}
        >
          AI-Powered Music Studio
        </motion.p>

        <motion.div
          className="features"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          <div className="feature">
            <span className="feature-icon">🎹</span>
            <h3>Smart Piano</h3>
            <p>Play a beautiful virtual piano with AI-enhanced recording and playback capabilities.</p>
          </div>
          
          <div className="feature">
            <span className="feature-icon">🤖</span>
            <h3>AI Music Generation</h3>
            <p>Generate real-time music using advanced AI prompts and intelligent controls.</p>
          </div>
          
          <div className="feature">
            <span className="feature-icon">🎵</span>
            <h3>Seamless Integration</h3>
            <p>Record melodies and instantly use them as the foundation for AI-generated compositions.</p>
          </div>

          <div className="feature">
            <span className="feature-icon">📂</span>
            <h3>Import & Enhance</h3>
            <p>Upload your MIDI files and recordings to enhance them with AI-powered music generation.</p>
          </div>
        </motion.div>

        <motion.div
          className="cta-section"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 1.1 }}
        >

          <Link to="/integrated" className="cta-button">
            🎵 Start Creating with BeatMind
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default LandingPage; 