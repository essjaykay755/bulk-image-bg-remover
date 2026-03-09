import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const { password, action } = await req.json();

        // Handle Logout
        if (action === "logout") {
            const response = NextResponse.json({ success: true });
            response.cookies.set("lumina_auth", "", {
                httpOnly: true,
                expires: new Date(0),
                path: "/",
            });
            return response;
        }

        // Handle Login
        const adminPassword = process.env.AUTH_PASSWORD || "password123";

        if (password === adminPassword) {
            const response = NextResponse.json({ success: true });

            // Set a secure cookie
            response.cookies.set("lumina_auth", adminPassword, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                maxAge: 60 * 60 * 24 * 7, // 1 week
                path: "/",
            });

            return response;
        }

        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    } catch (error) {
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
