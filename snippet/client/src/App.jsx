import React, { useState } from 'react';
import Header from './components/Header';
import MainContent from './components/MainContent';
import './App.css';

function App() {
  const [currentScreen, setCurrentScreen] = useState('home');

  return (
    <div className="App">
      <Header />
      <MainContent currentScreen={currentScreen} setCurrentScreen={setCurrentScreen} />
    </div>
  );
}

export default App; 