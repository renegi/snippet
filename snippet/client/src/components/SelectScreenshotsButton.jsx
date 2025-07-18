import React from "react";

const SelectScreenshotsButton = ({ 
  className = "",
  onClick,
  children = "Select screenshots",
  disabled = false
}) => {
  const handleClick = (e) => {
    console.log('SelectScreenshotsButton clicked!', { disabled, onClick: typeof onClick });
    if (!disabled && onClick) {
      onClick(e);
    }
  };

  return (
    <button
      className={`cursor-pointer h-16 px-10 bg-[#1b1b1b] w-full sm:w-auto sm:mx-auto rounded-[24px] box-border flex flex-row items-center justify-center gap-2 border-[1px] border-solid border-[#1b1b1b] hover:bg-[#333] hover:box-border hover:border-[1px] hover:border-solid hover:border-[#333] disabled:opacity-50 disabled:cursor-not-allowed shadow-lg transition-colors duration-200 ${className}`}
      onClick={handleClick}
      disabled={disabled}
    >
      <b className="relative text-2xl leading-[130%] font-termina-extrabold text-[#fff] text-center whitespace-nowrap">
        {children}
      </b>
    </button>
  );
};

export default SelectScreenshotsButton; 