"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor }
] as const;

/**
 * Light/Dark/System theme picker. `compact` renders an icon-only trigger for
 * the topbar (mobile), where the full sidebar footer is hidden.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const currentIcon = (
    <>
      {/* Sun/Moon via the .dark class so the trigger is SSR-safe (no hydration flip). */}
      <Sun className="size-[18px] dark:hidden" aria-hidden="true" />
      <Moon className="hidden size-[18px] dark:block" aria-hidden="true" />
    </>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button variant="outline" size="icon" aria-label="Toggle theme">
            {currentIcon}
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="w-full justify-start gap-2" aria-label="Toggle theme">
            {currentIcon}
            <span>Theme</span>
            <ChevronDown className="ml-auto size-3.5 opacity-60" aria-hidden="true" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup value={mounted ? theme : undefined} onValueChange={setTheme}>
          {OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} className="gap-2">
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
