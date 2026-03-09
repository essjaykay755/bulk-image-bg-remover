"use client";

import Link from "next/link";
import { Layers, Image as ImageIcon, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground font-sans selection:bg-accent/30 selection:text-accent-foreground p-6 sm:p-8 md:p-12 transition-colors duration-500">
      <div className="max-w-[1400px] mx-auto h-full flex flex-col items-center justify-center pt-20">

        {/* Header */}
        <header className="mb-16 text-center relative w-full">
          <button
            onClick={async () => {
              await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "logout" }),
              });
              window.location.href = "/login";
            }}
            className="absolute right-0 top-0 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors px-4 py-2 rounded-full border border-border bg-background/50 backdrop-blur-sm"
          >
            Logout
          </button>

          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tighter leading-none text-foreground mb-4">
            Lumina
          </h1>
          <p className="text-muted-foreground text-lg md:text-xl max-w-[60ch] leading-relaxed mx-auto">
            Professional bulk image processing, simplified.
            Zero server uploads. Absolute privacy.
          </p>
        </header>

        {/* Tools Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 w-full max-w-6xl">

          {/* Tool 1: BG Remover */}
          <Link href="/bg-remover" className="group">
            <div className="liquid-glass p-10 rounded-[2.5rem] h-full flex flex-col items-start transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl hover:border-accent/50 cursor-pointer overflow-hidden relative border border-border">
              <div className="w-16 h-16 bg-accent/10 rounded-2xl flex items-center justify-center mb-8 border border-accent/20 group-hover:bg-accent/20 transition-colors">
                <Layers className="w-8 h-8 text-accent" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-4 text-foreground group-hover:text-accent transition-colors">
                Background Remover
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed flex-1">
                Instantly extract subjects from white backgrounds and composite them against new environments in bulk.
              </p>

              {/* Decorative gradient orb */}
              <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-accent opacity-0 group-hover:opacity-10 blur-3xl rounded-full transition-opacity duration-700 pointer-events-none" />
            </div>
          </Link>

          {/* Tool 2: Watermark & Blur */}
          <Link href="/watermark-blur" className="group">
            <div className="liquid-glass p-10 rounded-[2.5rem] h-full flex flex-col items-start transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl hover:border-accent/50 cursor-pointer overflow-hidden relative border border-border">
              <div className="w-16 h-16 bg-foreground/5 rounded-2xl flex items-center justify-center mb-8 border border-foreground/10 group-hover:bg-foreground/10 transition-colors dark:bg-muted dark:border-muted-foreground/30">
                <ImageIcon className="w-8 h-8 text-foreground" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-4 text-foreground group-hover:text-foreground/80 transition-colors">
                Watermark & Surface Blur
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed flex-1">
                Apply persistent watermarks, logos, and selective surface color-range blurs to your source images.
              </p>

              {/* Decorative gradient orb */}
              <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-foreground opacity-0 group-hover:opacity-5 dark:group-hover:opacity-10 blur-3xl rounded-full transition-opacity duration-700 pointer-events-none" />
            </div>
          </Link>

          {/* Tool 3: AI Retouch */}
          <Link href="/ai-retouch" className="group">
            <div className="liquid-glass p-10 rounded-[2.5rem] h-full flex flex-col items-start transition-all duration-500 hover:scale-[1.02] hover:shadow-2xl hover:border-purple-500/50 cursor-pointer overflow-hidden relative border border-border">
              <div className="w-16 h-16 bg-purple-500/10 rounded-2xl flex items-center justify-center mb-8 border border-purple-500/20 group-hover:bg-purple-500/20 transition-colors">
                <Sparkles className="w-8 h-8 text-purple-500" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-4 text-foreground group-hover:text-purple-500 transition-colors">
                AI Retouch
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed flex-1">
                Transform rough photoshops into realistic product photography using Gemini AI.
              </p>

              {/* Decorative gradient orb */}
              <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-purple-500 opacity-0 group-hover:opacity-10 blur-3xl rounded-full transition-opacity duration-700 pointer-events-none" />
            </div>
          </Link>

        </div>
      </div>
    </div>
  );
}

