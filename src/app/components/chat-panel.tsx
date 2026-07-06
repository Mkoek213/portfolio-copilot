"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { sendChatMessageAction, type ActionResult } from "../actions";
import { ActionStatus } from "./action-status";
import type { LocalLlmModelPreset } from "@/lib/llm/model-presets";

const initialState: ActionResult = { status: "idle", message: "" };

function SendButton() {
  const { pending } = useFormStatus();

  return (
    <button className="primary-button" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
      {pending ? "Sending" : "Send"}
    </button>
  );
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
  const router = useRouter();

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status, state.timestamp]);

  return (
    <div className="chat-layout">
      <div className="message-list" aria-live="polite">
        {messages.length === 0 ? <p className="empty-state">No local chat messages yet.</p> : null}
        {messages.map((message) => (
          <article className={`message-bubble ${message.role}`} key={message.id}>
            <span>{message.role}</span>
            <p>{message.content}</p>
          </article>
        ))}
      </div>
      <form action={action} className="chat-form">
        <label className="model-select slim-select">
          <span>Local model</span>
          <select name="llmModel" defaultValue={defaultModel}>
            {modelPresets.map((preset) => (
              <option key={preset.key} value={preset.model}>
                {preset.label} · {preset.model}
              </option>
            ))}
          </select>
        </label>
        <label className="chat-input">
          <span>Message</span>
          <textarea name="content" rows={4} required />
        </label>
        <div className="form-actions">
          <SendButton />
          <ActionStatus state={state} />
        </div>
      </form>
    </div>
  );
}
