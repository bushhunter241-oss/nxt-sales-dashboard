"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Loader2, MessageCircle } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const QUICK_QUESTIONS = [
  "今月の概況は？",
  "ACOSが高いキャンペーンは？",
  "来月の施策提案して",
  "在庫は足りてる？",
];

export function AiChatWindow() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const sendMessage = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput("");

    const newMessages = [...messages, { role: "user" as const, content: msg }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history: newMessages.slice(-20) }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "API error" }));
        setMessages([...newMessages, { role: "assistant", content: `⚠️ ${err.error || "エラーが発生しました"}` }]);
        setLoading(false);
        return;
      }

      // ストリーミング読み取り
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");

      let assistantMsg = "";
      setMessages([...newMessages, { role: "assistant", content: "" }]);

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter(l => l.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              assistantMsg += parsed.text;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: assistantMsg };
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setMessages([...newMessages, { role: "assistant", content: `⚠️ ${err.message || "通信エラー"}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, messages, loading]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-white shadow-lg hover:opacity-90 transition-opacity"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col w-[400px] h-[600px] max-h-[80vh] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-2xl md:w-[400px] md:h-[600px]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
        <span className="text-sm font-bold">🤖 AI分析アシスタント</span>
        <button onClick={() => setOpen(false)} className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-[hsl(var(--muted-foreground))] text-center py-8">
            売上や広告のデータについて質問できます。
            <br />例:「今月のfeela売上はどう？」「ACOSを改善するには？」
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-[hsl(var(--primary))] text-white"
                : "bg-[hsl(var(--muted))] text-[hsl(var(--foreground))]"
            }`}>
              {msg.content || (loading && i === messages.length - 1 ? "..." : "")}
            </div>
          </div>
        ))}
      </div>

      {/* Quick questions */}
      {messages.length === 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-2 border-t border-[hsl(var(--border))]">
          {QUICK_QUESTIONS.map((q, i) => (
            <button
              key={i}
              onClick={() => sendMessage(q)}
              className="whitespace-nowrap rounded-full border border-[hsl(var(--border))] px-3 py-1 text-xs hover:bg-[hsl(var(--muted))] transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 border-t border-[hsl(var(--border))] p-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
          placeholder="質問を入力..."
          disabled={loading}
          className="flex-1 rounded-lg border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
        />
        <button
          onClick={() => sendMessage()}
          disabled={loading || !input.trim()}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary))] text-white disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
