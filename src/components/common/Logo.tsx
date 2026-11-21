import React from "react";

import logo from "../../assets/youglidetube-logo.png";
import logoMono from "../../assets/youglidetube-logo-mono.png";

interface LogoProps {
  className?: string;
  size?: number;
  showText?: boolean;
  /** The solid-white silhouette, used in Deep Glide mode. */
  monochrome?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ className = "", size = 48, showText = false, monochrome = false }) => {
  return (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      <img
        src={monochrome ? logoMono : logo}
        width={size}
        height={size}
        alt="YouGlideTube"
        className="shrink-0 rounded-[22%] transition-transform duration-300 hover:scale-105 active:scale-95 cursor-pointer"
        draggable={false}
      />
      {showText && (
        <span className="font-extrabold text-xl tracking-tight text-chrome-neutral-100">
          YouGlideTube
        </span>
      )}
    </div>
  );
};

export default Logo;
