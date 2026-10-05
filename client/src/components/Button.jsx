import React from "react";

const VARIANTS = {
  primary: "bg-[#1b1b1b] text-white hover:bg-[#333]",
  secondary: "bg-[#DDDAD1] text-[#1B1B1B] hover:bg-[#E4E0D2]",
  destructive: "bg-transparent border border-solid border-[#BE3E37] text-[#BE3E37] hover:bg-[#BE3E37] hover:text-white",
};

// `square` is the width used when the button has an icon and no label
const SIZES = {
  l: { base: "h-16 rounded-[24px] text-xl font-termina-extrabold", padding: "px-10", square: "w-16", icon: "[&>svg]:h-6 [&>svg]:w-6" },
  m: { base: "h-14 rounded-[24px] text-base font-['Termina'] font-bold", padding: "px-6", square: "w-14", icon: "[&>svg]:h-5 [&>svg]:w-5" },
  s: { base: "h-10 rounded-[12px] text-sm font-['Termina'] font-bold", padding: "px-4", square: "w-10", icon: "[&>svg]:h-5 [&>svg]:w-5" },
  xs: { base: "h-8 rounded-[12px] text-xs font-['Termina'] font-bold", padding: "px-3", square: "w-8", icon: "[&>svg]:h-4 [&>svg]:w-4" },
};

// Takes a label (children), an icon, or both. An icon-only button needs an aria-label.
const Button = ({
  variant = "primary",
  size = "m",
  icon,
  className = "",
  children,
  ...props
}) => {
  const { base, padding, square, icon: iconSize } = SIZES[size];
  const hasLabel = React.Children.count(children) > 0;

  return (
    <button
      className={`cursor-pointer box-border shrink-0 flex flex-row items-center justify-center gap-2 text-center leading-[130%] whitespace-nowrap transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${base} ${hasLabel ? padding : square} ${className}`}
      {...props}
    >
      {icon && <span className={`flex shrink-0 ${iconSize}`} aria-hidden="true">{icon}</span>}
      {children}
    </button>
  );
};

export default Button;
