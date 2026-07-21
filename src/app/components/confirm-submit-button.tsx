"use client";

import { useFormStatus } from "react-dom";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";

/**
 * A submit button gated behind an AlertDialog confirmation. Must be rendered
 * inside the `<form action={...}>` it guards (it reads `useFormStatus` for the
 * pending state); `onConfirm` should call `formRef.current?.requestSubmit()`.
 * The Server Action itself is untouched - this only adds a confirm gate in
 * front of the existing submit.
 */
export function ConfirmSubmitButton({
  icon: Icon,
  label,
  variant = "destructive-outline",
  title,
  description,
  confirmLabel = "Confirm",
  destructive = true,
  onConfirm
}: {
  icon: LucideIcon;
  label: string;
  variant?: "outline" | "destructive-outline" | "default";
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const { pending } = useFormStatus();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size="sm" type="button" disabled={pending} aria-busy={pending}>
          {pending ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Icon size={16} aria-hidden="true" />}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(destructive && "bg-destructive text-white hover:bg-destructive/90")}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
