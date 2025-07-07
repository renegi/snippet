import React from 'react';
import { MicrophoneIcon } from '@heroicons/react/24/outline';

function Header() {
  return (
    <header className="bg-white shadow">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <MicrophoneIcon className="h-8 w-8 text-indigo-600" />
            <h1 className="text-2xl font-bold text-gray-900">PodQuote</h1>
          </div>
          <p className="text-sm text-gray-500">
            Extract quotes from your favorite podcasts
          </p>
        </div>
      </div>
    </header>
  );
}

export default Header; 