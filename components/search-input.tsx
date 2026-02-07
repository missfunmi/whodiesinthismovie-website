"use client";

import { useRef, useEffect } from "react";
import { Search } from "lucide-react";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
};

/**
 * Styled search input with search icon.
 * Auto-focuses on mount. Font size 16px+ prevents iOS zoom.
 */
export default function SearchInput({
  value,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
}: SearchInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Search for a movie..."
        aria-label="Search for a movie"
        autoComplete="off"
        className="w-full pl-12 pr-4 py-5 text-lg rounded-xl bg-white/95 text-gray-900 placeholder:text-gray-500 placeholder:font-medium focus:outline-none focus:ring-4 focus:ring-blue-500 shadow-2xl"
      />
    </div>
  );
}
