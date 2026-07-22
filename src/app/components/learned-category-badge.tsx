import { GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Tiny "learned" marker shown next to a CategorySelect when a category came
 * from a learned rule (`categorySource === "learned"`). Auditable and trivially
 * overridable - it disappears the moment the user re-categorizes (source flips
 * to "user"). See plan 19. No hooks, so it renders in server and client trees.
 */
export function LearnedCategoryBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="muted"
      className={cn("mt-1 gap-1 px-1.5 text-[0.68rem]", className)}
      aria-label="Kategoria nauczona z Twoich wcześniejszych poprawek"
      title="Kategoria nauczona z Twoich wcześniejszych poprawek"
    >
      <GraduationCap aria-hidden="true" />
      nauczone
    </Badge>
  );
}
