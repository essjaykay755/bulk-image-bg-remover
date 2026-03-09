import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const PROMPT = `You are an expert product photography retoucher. Edit this product image to look like a real studio photograph.

CRITICAL RULES — you must follow ALL of these:

GROUNDING: The product must rest firmly on the surface. It must NOT float or hover. Add a realistic contact shadow directly beneath the product where it touches the surface. The bottom edge of the product must make full contact with the surface.

COLORS: Preserve the EXACT original colors of the product. Do not shift, saturate, desaturate, warm, or cool the product colors. The product's hue, saturation, and brightness must match the input image precisely.

SMOOTH GRADIENTS: All background areas and surfaces must have perfectly smooth, continuous tone transitions. Do NOT produce any banding, posterization, or stepped color transitions. Gradients must be smooth and artifact-free.

WHAT TO IMPROVE:
- Make the lighting look natural and studio-quality with soft, diffused illumination
- Add realistic soft shadows (especially contact shadows where product meets surface)
- Enhance surface texture realism (leather grain, fabric weave, metal sheen, etc.)
- Make the environment (surface and background) look physically plausible and naturally lit

WHAT TO PRESERVE EXACTLY:
- Product shape, angle, composition, and placement
- Product colors (exact match)
- All logos, text, branding, and embossed details
- Product proportions and scale

WHAT NOT TO DO:
- Do NOT make the product float or hover above the surface
- Do NOT change product colors in any way
- Do NOT add or remove any objects
- Do NOT create banding or posterization in backgrounds
- Do NOT change the product's position or angle

Output a single high-quality image.`;

export async function POST(req: NextRequest) {
    try {
        const apiKey = process.env.GOOGLE_AI_API_KEY;
        if (!apiKey || apiKey === "your-api-key-here") {
            return NextResponse.json(
                { error: "GOOGLE_AI_API_KEY is not configured. Add it to .env.local" },
                { status: 500 }
            );
        }

        const { imageBase64, mimeType, fixWrinkles } = await req.json();

        if (!imageBase64 || !mimeType) {
            return NextResponse.json(
                { error: "Missing imageBase64 or mimeType" },
                { status: 400 }
            );
        }

        let finalPrompt = PROMPT;
        if (fixWrinkles) {
            finalPrompt += `\n\nADDITIONAL INSTRUCTION — FIX WRINKLES: The product has heavy wrinkles and creases on its leather/fabric surface. Smooth out these wrinkles significantly while keeping the natural leather grain texture intact. The surface should look like a brand-new, unwrinkled product fresh from the factory. Remove deep creases, folds, and deformation marks, but preserve natural material texture (grain, pores, stitching).`;
        }

        const ai = new GoogleGenAI({ apiKey });

        const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-image-preview",
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: finalPrompt },
                        {
                            inlineData: {
                                mimeType,
                                data: imageBase64,
                            },
                        },
                    ],
                },
            ],
            config: {
                responseModalities: ["TEXT", "IMAGE"],
            },
        });

        // Extract the generated image from the response
        const parts = response.candidates?.[0]?.content?.parts;
        if (!parts) {
            return NextResponse.json(
                { error: "No response from AI model" },
                { status: 500 }
            );
        }

        // Find the image part in the response
        for (const part of parts) {
            if (part.inlineData?.data) {
                return NextResponse.json({
                    imageBase64: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || "image/png",
                });
            }
        }

        // If no image was generated, return text response for debugging
        const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text);
        return NextResponse.json(
            { error: `No image generated. Model response: ${textParts.join(" ")}` },
            { status: 500 }
        );
    } catch (error: any) {
        console.error("AI Retouch error:", error);
        return NextResponse.json(
            { error: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
