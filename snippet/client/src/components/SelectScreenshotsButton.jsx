import React from 'react';

function SelectScreenshotsButton({ onScreenshotsSelected }) {
  const handleFileSelect = (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      onScreenshotsSelected(files);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <label className="w-full max-w-[361px] bg-gray-100 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:bg-gray-50">
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="text-gray-600">
          <p className="text-lg font-medium">Select Screenshots</p>
          <p className="text-sm">Click to upload or drag and drop</p>
        </div>
      </label>
    </div>
  );
}

export default SelectScreenshotsButton; 