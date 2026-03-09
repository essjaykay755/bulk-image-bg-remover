"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Lock, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

export default function LoginPage() {
    const [password, setPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError("");

        try {
            // In a real app, this would be an API call to avoid exposure
            // For this basic auth, we check via a server-side component or just match the env
            // However, we'll implement a simple client-side action that works with our middleware

            const response = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
            });

            if (response.ok) {
                router.push("/");
                router.refresh();
            } else {
                const data = await response.json();
                setError(data.error || "Invalid password");
            }
        } catch (err) {
            setError("An unexpected error occurred");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-[100dvh] bg-background text-foreground font-sans flex items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md w-full"
            >
                <div className="text-center mb-10">
                    <h1 className="text-5xl font-extrabold tracking-tighter leading-none text-foreground mb-4">
                        Lumina
                    </h1>
                    <p className="text-muted-foreground text-lg">
                        Professional Image Suite
                    </p>
                </div>

                <div className="liquid-glass p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Sparkles className="w-24 h-24 text-accent" />
                    </div>

                    <form onSubmit={handleLogin} className="relative z-10 space-y-6">
                        <div className="space-y-2">
                            <label
                                htmlFor="password"
                                className="text-sm font-semibold flex items-center gap-2 text-foreground/70"
                            >
                                <Lock className="w-4 h-4" />
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter password"
                                className="w-full px-6 py-4 bg-background/50 border border-border rounded-2xl text-lg font-medium focus:outline-accent focus:ring-4 focus:ring-accent/10 transition-all"
                                autoFocus
                            />
                        </div>

                        {error && (
                            <motion.p
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="text-sm font-semibold text-red-500 text-center"
                            >
                                {error}
                            </motion.p>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading || !password}
                            className="w-full py-4 bg-foreground text-background rounded-2xl font-bold text-lg shadow-xl hover:shadow-2xl active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:pointer-events-none"
                        >
                            {isLoading ? (
                                <Loader2 className="w-6 h-6 animate-spin" />
                            ) : (
                                <>
                                    Access Suite
                                </>
                            )}
                        </button>
                    </form>
                </div>

                <p className="mt-8 text-center text-sm text-muted-foreground font-medium">
                    Secure browser-side processing. Your data stays private.
                </p>
            </motion.div>
        </div>
    );
}
