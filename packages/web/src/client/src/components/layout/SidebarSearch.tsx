/**
 * SidebarSearch component
 *
 * A compact search input with search icon and clear button.
 * Reusable component used by both Fleet View and Recent Conversations tabs.
 * Uses herd-* design tokens for styling.
 */

import { Search, X } from "lucide-react";
import { useCallback, useRef } from "react";

interface SidebarSearchProps {
  /** Current search query value */
  value: string;
  /** Called when the search query changes */
  onChange: (value: string) => void;
  /** Placeholder text for the input */
  placeholder?: string;
}

export function SidebarSearch({ value, onChange, placeholder = "Search..." }: SidebarSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = useCallback(() => {
    onChange("");
    inputRef.current?.focus();
  }, [onChange]);

  return (
    <div className="relative mx-2 mb-2">
      {/* Search icon */}
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-herd-sidebar-muted pointer-events-none" />

      {/* Input */}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-herd-input-bg border border-herd-border rounded-lg pl-8 pr-8 py-1.5 text-xs text-herd-sidebar-fg placeholder:text-herd-sidebar-muted focus:outline-none focus:border-herd-primary/60 transition-colors"
      />

      {/* Clear button - only visible when there's text */}
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-herd-sidebar-hover transition-colors"
          title="Clear search"
        >
          <X className="w-3.5 h-3.5 text-herd-sidebar-muted hover:text-herd-sidebar-fg" />
        </button>
      )}
    </div>
  );
}
