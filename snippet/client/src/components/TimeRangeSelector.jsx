import React from 'react';

function TimeRangeSelector({ timeRange, onTimeRangeChange }) {
  const handleChange = (field, value) => {
    onTimeRangeChange({
      ...timeRange,
      [field]: parseInt(value, 10)
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-gray-900">Transcript Range</h3>
      
      <div className="space-y-4">
        <div>
          <label htmlFor="before-range" className="block text-sm font-medium text-gray-700">
            Seconds Before: {timeRange.before}s
          </label>
          <input
            id="before-range"
            type="range"
            min="0"
            max="120"
            step="5"
            value={timeRange.before}
            onChange={(e) => handleChange('before', e.target.value)}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        <div>
          <label htmlFor="after-range" className="block text-sm font-medium text-gray-700">
            Seconds After: {timeRange.after}s
          </label>
          <input
            id="after-range"
            type="range"
            min="0"
            max="120"
            step="5"
            value={timeRange.after}
            onChange={(e) => handleChange('after', e.target.value)}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>

      <div className="text-sm text-gray-500">
        <p>Total range: {timeRange.before + timeRange.after} seconds</p>
      </div>
    </div>
  );
}

export default TimeRangeSelector; 