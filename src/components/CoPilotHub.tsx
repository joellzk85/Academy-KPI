import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, AlertCircle, Bot, User, BrainCircuit, RefreshCw, Terminal } from 'lucide-react';
import { ChatMessage, Cohort, Student, ScheduleItem, FeedbackItem } from '../types';
import { motion } from 'motion/react';

interface CoPilotHubProps {
  cohorts: Cohort[];
  students: Student[];
  schedule: ScheduleItem[];
  feedback: FeedbackItem[];
}

export default function CoPilotHub({ cohorts, students, schedule, feedback }: CoPilotHubProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init-msg',
      role: 'model',
      text: "Hello! I am your NEXT Academic Co-Pilot. I am fully synchronized with the academy's current active cohorts, student rosters, weekly schedules, and survey feedback. \n\nHow can I help you optimize class performance, draft student emails, or analyze career pipelines today?",
      timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Suggestion prompt chips
  const suggestions = [
    { label: "Struggling web dev students", prompt: "Identify the struggling students (at academic risk) in the Full-Stack Web Development (Co-18) cohort and summarize their issues." },
    { label: "Draft student outreach", prompt: "Write a supportive email draft to student Jonathan Lim about his low attendance and incomplete database assignments." },
    { label: "Feedback sentiment review", prompt: "Summarize the student feedback comments. What are the key positive points and which areas need operational improvement?" },
    { label: "iOS Swift study plan", prompt: "Alex Tan in iOS developer cohort is struggling with SwiftUI and Swift OOP. Suggest a structured 2-week remedial study plan." }
  ];

  const handleSend = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setLoading(true);

    try {
      const response = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(m => ({ role: m.role, text: m.text })),
          datasetContext: {
            cohorts,
            students,
            schedule,
            feedback
          }
        })
      });

      const data = await response.json();
      if (response.ok) {
        setMessages(prev => [...prev, {
          id: `ai-${Date.now()}`,
          role: 'model',
          text: data.response,
          timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: `ai-err-${Date.now()}`,
          role: 'model',
          text: `Failed to generate response: ${data.details || "Internal co-pilot service error."}`,
          timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        }]);
      }
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [...prev, {
        id: `ai-err-${Date.now()}`,
        role: 'model',
        text: `Network failure: Could not establish secure socket tunnel to co-pilot. ${err.message || ""}`,
        timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      }]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: 'init-msg',
        role: 'model',
        text: "Hello! I am your NEXT Academic Co-Pilot. I am fully synchronized with the academy's current active cohorts, student rosters, weekly schedules, and survey feedback. \n\nHow can I help you optimize class performance, draft student emails, or analyze career pipelines today?",
        timestamp: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      }
    ]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[650px] max-h-[75vh]" id="ai-copilot-section">
      
      {/* Suggestions Panel */}
      <div className="lg:col-span-1 bg-slate-900/40 border border-slate-800/80 p-5 rounded-2xl flex flex-col justify-between space-y-4">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-white font-display uppercase tracking-wider">
              AI Query Assistant
            </h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Click any suggestion block to query Gemini directly with our live cohort analytics context.
          </p>

          <div className="space-y-2">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(s.prompt)}
                className="w-full text-left p-3 bg-slate-950/40 border border-slate-850 hover:border-slate-700 rounded-xl text-xs text-slate-300 hover:text-white transition-all cursor-pointer block hover:bg-slate-900/30"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={clearChat}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer border border-slate-700/40"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Clear Conversation History
        </button>
      </div>

      {/* Main Interactive Chat Window */}
      <div className="lg:col-span-3 bg-slate-900/40 border border-slate-800/80 rounded-2xl flex flex-col overflow-hidden h-full">
        
        {/* Chat Window Header */}
        <div className="bg-slate-950/50 p-4 border-b border-slate-850 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Bot className="w-5 h-5 text-cyan-400" />
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider font-display flex items-center gap-1">
                Academic Operations Console
              </h4>
              <p className="text-[10px] text-slate-400 mt-0.5">Dual-channel context mapping (Gemini-3.5-flash)</p>
            </div>
          </div>
          <span className="flex items-center gap-1.5 text-[10px] text-cyan-400 bg-cyan-400/5 px-2.5 py-1 rounded-lg border border-cyan-400/15 font-mono font-bold">
            <Terminal className="w-3 h-3 text-cyan-400" />
            Active Sync
          </span>
        </div>

        {/* Chat Message Logs Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((m) => {
            const isBot = m.role === 'model';
            return (
              <div 
                key={m.id}
                className={`flex gap-3 max-w-[85%] ${isBot ? 'mr-auto' : 'ml-auto flex-row-reverse'}`}
              >
                <div className={`p-2.5 rounded-xl h-fit ${isBot ? 'bg-slate-800 text-cyan-400 border border-slate-700/40' : 'bg-gradient-to-br from-cyan-600 to-indigo-600 text-white'}`}>
                  {isBot ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>
                
                <div className="space-y-1">
                  <div className={`p-4 rounded-2xl text-xs leading-relaxed whitespace-pre-line ${isBot ? 'bg-slate-950/40 border border-slate-850 text-slate-300' : 'bg-slate-800 text-slate-200'}`}>
                    {m.text}
                  </div>
                  <p className={`text-[9px] text-slate-500 font-mono ${isBot ? 'text-left' : 'text-right'}`}>
                    {m.timestamp}
                  </p>
                </div>
              </div>
            );
          })}

          {loading && (
            <div className="flex gap-3 max-w-[80%] mr-auto">
              <div className="p-2.5 rounded-xl bg-slate-800 text-cyan-400 border border-slate-700/40 h-fit">
                <Bot className="w-4 h-4" />
              </div>
              <div className="p-4 rounded-2xl bg-slate-950/40 border border-slate-850 text-xs flex items-center gap-2">
                <div className="flex space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-slate-400">Co-Pilot is researching...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Text Form */}
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleSend(inputText);
          }}
          className="p-4 bg-slate-950/40 border-t border-slate-850 flex items-center gap-3"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={loading}
            placeholder="Ask anything (e.g. 'Draft a remedial plan for Alex' or 'Synthesize Web Dev risk profile')..."
            className="flex-1 bg-slate-900 border border-slate-850 rounded-xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || loading}
            className="p-3 bg-gradient-to-r from-cyan-500 to-indigo-500 text-white rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

      </div>

    </div>
  );
}
