import React from "react";

const PrimaryButtonL = ({ 
  className = "",
  onClick,
  children,
  property1 = "Default",
  disabled = false
}) => {
  const handleClick = (e) => {
    console.log('PrimaryButtonL clicked!', { disabled, onClick: typeof onClick });
    if (!disabled && onClick) {
      onClick(e);
    }
  };

  const handleTouchStart = (e) => {
    // Prevent touch events from being converted to mouse events
    // This ensures the button works properly on mobile
    if (!disabled) {
      e.preventDefault();
    }
  };

  return (
    <button
      className={`cursor-pointer h-16 px-6 bg-[#1b1b1b] w-full max-w-[361px] rounded-[24px] box-border flex flex-row items-center justify-center gap-2 border-[1px] border-solid border-[#1b1b1b] hover:bg-[#333] hover:box-border hover:border-[1px] hover:border-solid hover:border-[#333] disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      disabled={disabled}
    >
      <b className="relative text-lg leading-[130%] font-['Termina'] text-[#fff] text-center whitespace-nowrap">
        {children}
      </b>
    </button>
  );
};

export default PrimaryButtonL; 