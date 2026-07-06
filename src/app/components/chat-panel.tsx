"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Send, Sparkles, User } from "lucide-react";
import { sendChatMessageAction, type ActionResult } from "../actions";
import { MarkdownLite } from "./markdown";
import type { LocalLlmModelPreset } from "@/lib/llm/model-presets";

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
    <button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
      {pending ? "Thinking" : "Send"}
    </button>
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
  const [state, action] = useActionState(sendChatMessageAction, initialState);
  const [draft, setDraft] = useState("");
  const router = useRouter();
  const listRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      setDraft("");
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const isError = state.status === "error";

  return (
    <div className="chat-layout">
      <div className="message-list" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <Sparkles aria-hidden="true" />
            <h3>Ask about your money</h3>
            <p>The assistant answers only from local data: transactions, reports, portfolio and memory. Nothing leaves this machine.</p>
          </div>
        ) : null}
        {messages.map((message) => {
          const isUser = message.role === "user";

          return (
            <article className={`message ${isUser ? "message-user" : "message-assistant"}`} key={message.id}>
              <div className="message-avatar" aria-hidden="true">
                {isUser ? <User size={15} /> : <Bot size={15} />}
              </div>
              <div className="message-body">
                <header>
                  <strong>{isUser ? "You" : "Copilot"}</strong>
                  <time>{formatTime(message.createdAt)}</time>
                </header>
                {isUser ? <p className="message-text">{message.content}</p> : <MarkdownLite content={message.content} />}
              </div>
            </article>
          );
        })}
        {isError ? (
          <div className="chat-error" role="alert">
            <strong>{state.message}</strong>
            {state.detail ? <span>{state.detail}</span> : null}
          </div>
        ) : null}
      </div>

      <form action={action} className="chat-composer" ref={formRef}>
        {messages.length === 0 ? (
          <div className="prompt-chips" aria-label="Suggested questions">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button key={prompt} type="button" className="prompt-chip" onClick={() => setDraft(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
        <div className="chat-input-row">
          <textarea
            name="content"
            rows={2}
            required
            placeholder="Ask about spending, allocation or reports… (Enter to send)"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          <div className="chat-input-side">
            <label className="chat-model" aria-label="Local model">
              <select name="llmModel" defaultValue={defaultModel}>
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
