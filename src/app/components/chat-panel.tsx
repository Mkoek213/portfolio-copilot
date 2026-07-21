"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Bot, Check, Copy, Loader2, Send, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendChatMessageAction, type ActionResult } from "../actions";
import { MarkdownLite } from "./markdown";
import type { LocalLlmModelPreset } from "@/lib/llm/model-presets";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground focus-visible:opacity-100 group-hover/msg:opacity-100"
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy message"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be unavailable (insecure context); ignore silently.
        }
      }}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
}

function TypingIndicator() {
  const reduceMotion = useReducedMotion();

  return (
    <article className="flex max-w-[min(720px,88%)] gap-2.5 self-start" aria-hidden="true">
      <div className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-strong">
        <Bot size={15} />
      </div>
      <div className="flex items-center gap-1 rounded-xl rounded-tl-sm bg-secondary px-3.5 py-3">
        {[0, 1, 2].map((dot) => (
          <motion.span
            key={dot}
            className="block size-1.5 rounded-full bg-muted-foreground"
            animate={reduceMotion ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={reduceMotion ? undefined : { duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: dot * 0.15 }}
          />
        ))}
      </div>
    </article>
  );
}

const initialState: ActionResult = { status: "idle", message: "" };

const SUGGESTED_PROMPTS = [
  "Ile wydałem w tym miesiącu i na co najwięcej?",
  "Jak wygląda moja alokacja względem celu?",
  "Podsumuj ostatni raport w trzech punktach.",
  "Które kategorie wydatków rosną?"
];

function SendButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">
      {pending ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
      {pending ? "Thinking" : "Send"}
    </Button>
  );
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("pl-PL", { timeStyle: "short" }).format(new Date(value));
}

export function ChatPanel({
  messages,
  modelPresets,
  defaultModel
}: {
  messages: Array<{ id: string; role: string; content: string; createdAt: Date }>;
  modelPresets: LocalLlmModelPreset[];
  defaultModel: string;
}) {
  const [state, action, isPending] = useActionState(sendChatMessageAction, initialState);
  const [draft, setDraft] = useState("");
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "idle") {
      return;
    }

    // A failed exchange can still be persisted (user message + error reply), so
    // clear the draft to prevent Enter from re-sending a duplicate.
    if (state.status === "success" || state.persisted) {
      setDraft("");
    }

    router.refresh();
  }, [router, state.status, state.timestamp, state.persisted]);

  useEffect(() => {
    // Also scroll when the typing indicator appears/disappears.
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, isPending]);

  const isError = state.status === "error";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex min-h-[300px] flex-1 flex-col gap-3.5 overflow-y-auto p-1 max-h-[calc(100vh-380px)]" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="m-auto grid max-w-[400px] justify-items-center gap-2 px-4 py-8 text-center text-muted-foreground">
            <Sparkles aria-hidden="true" className="text-brand" />
            <h3 className="text-[0.95rem] font-[650] text-foreground">Ask about your money</h3>
            <p className="text-[0.84rem] leading-[1.55]">The assistant answers only from local data: transactions, reports, portfolio and memory. Nothing leaves this machine.</p>
          </div>
        ) : null}
        {messages.map((message, index) => {
          const isUser = message.role === "user";
          const previous = index > 0 ? messages[index - 1] : null;
          // Group consecutive messages from the same sender within 5 minutes:
          // hide the repeated avatar + name/time header.
          const grouped =
            previous !== null &&
            previous.role === message.role &&
            new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000;

          return (
            <article
              className={cn("group/msg flex max-w-[min(720px,88%)] gap-2.5", isUser ? "flex-row-reverse self-end" : "self-start", grouped && "-mt-2.5")}
              key={message.id}
            >
              <div
                className={cn(
                  "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full",
                  grouped ? "invisible" : isUser ? "bg-info-soft text-info" : "bg-brand-soft text-brand-strong"
                )}
                aria-hidden="true"
              >
                {grouped ? null : isUser ? <User size={15} /> : <Bot size={15} />}
              </div>
              <div className={cn("min-w-0 rounded-xl px-3 py-2.5", isUser ? "rounded-tr-sm bg-brand-soft" : "rounded-tl-sm bg-secondary")}>
                <header className="mb-0.5 flex items-baseline gap-2">
                  {grouped ? null : (
                    <>
                      <strong className="text-[0.74rem] font-[650]">{isUser ? "You" : "Copilot"}</strong>
                      <time className="text-[0.68rem] text-muted-foreground">{formatTime(message.createdAt)}</time>
                    </>
                  )}
                  <CopyButton text={message.content} />
                </header>
                {isUser ? <p className="m-0 whitespace-pre-wrap text-[0.88rem] leading-[1.5] [overflow-wrap:anywhere]">{message.content}</p> : <MarkdownLite content={message.content} />}
              </div>
            </article>
          );
        })}
        {isPending ? <TypingIndicator /> : null}
        {isError ? (
          <div className="grid gap-0.5 rounded-md bg-crit-soft px-3 py-2.5 text-[0.84rem] text-crit" role="alert">
            <strong>{state.message}</strong>
            {state.detail ? <span className="opacity-90">{state.detail}</span> : null}
          </div>
        ) : null}
      </div>

      <form action={action} className="grid gap-2.5 border-t border-border pt-3.5" ref={formRef}>
        {messages.length === 0 ? (
          <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="rounded-full border border-input bg-background px-3 py-1.5 text-[0.8rem] text-muted-foreground transition-colors hover:border-brand hover:bg-brand-soft hover:text-brand-strong"
                onClick={() => setDraft(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-stretch gap-2.5 max-[640px]:flex-col">
          <Textarea
            name="content"
            rows={2}
            required
            className="min-h-[58px] flex-1 resize-y text-[0.9rem]"
            placeholder="Ask about spending, allocation or reports… (Enter to send)"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                return;
              }

              event.preventDefault();

              if (!isPending) {
                formRef.current?.requestSubmit();
              }
            }}
          />
          <div className="flex w-[168px] flex-shrink-0 flex-col justify-end gap-2 max-[640px]:w-full max-[640px]:flex-row">
            <label className="max-[640px]:flex-1" aria-label="Local model">
              <select
                name="llmModel"
                defaultValue={defaultModel}
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-[0.78rem] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {modelPresets.map((preset) => (
                  <option key={preset.key} value={preset.model}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <SendButton />
          </div>
        </div>
      </form>
    </div>
  );
}
