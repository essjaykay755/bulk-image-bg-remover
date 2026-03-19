import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const PROMPT = `You are an expert product photography retoucher. Edit this product image to look like a real studio photograph.

CRITICAL RULES - you must follow ALL of these:

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

const FIX_TRANSPARENCY_PROMPT = `ADDITIONAL INSTRUCTION - FIX TRANSPARENCY:

Act as an expert in digital image restoration specializing in correcting transparency anomalies in product photography, especially wallet images where automated background removal has accidentally deleted white or light product elements.

Purpose:
- Fix transparency anomalies only.
- Restore missing or partially deleted white/light elements such as banknotes, logos, dummy ID cards, labels, and similar printed inserts that belong to the product scene.
- Keep the wallet, box, background, composition, and all correctly processed areas unchanged.

Image analysis:
- Carefully inspect the image for areas where background removal mistakenly removed internal white or light-colored product details.
- Distinguish between the intended outer background and internal product elements that must remain visible.

Restoration rules:
- Re-generate or fill in only the missing product pixels in the damaged areas.
- Make the restoration seamless and consistent with the existing texture, lighting, sharpness, and perspective.
- Do not modify the wallet structure, box structure, stitching, engravings, embossing, or any physical geometry.
- If there is engraving, do not touch it.
- Maintain the original note arrangement exactly. Do not change the position, angle, overlap, or stack order of the currency.
- Restore ID cards, notes, logos, and white printed regions as solid, natural, opaque objects. They must not look transparent, ghosted, faded, or see-through.
- For gift box logos specifically: detect any areas inside the logo where the box color or background color is bleeding through because of transparency damage, and replace that bleed-through with solid white. The logo should read as a clean white printed mark, not a translucent logo tinted by the box or background color.
- If currency denominations are unclear or partially erased, reconstruct missing sections using believable visual cues from common Indian Rupee notes such as 500, 200, 100, or 50, while preserving the visible arrangement in the image.
- Strictly do not modify any existing physical structures of the wallet or product. Only fill transparency anomalies.

Quality checks:
- Compare the repaired result to the provided image and ensure that all transparency anomalies are fixed.
- Do not introduce new artifacts.
- Do not repaint the whole image.
- Do not change unaffected regions.
- Do not alter the added background.
- Do not make the product look washed out or semi-transparent.
- For gift box logos, do not leave blue, grey, or box-colored pixels showing through the white logo shape.

Return one corrected image with the transparency issues fixed and everything else preserved as closely as possible.`;

export async function POST(req: NextRequest) {
    try {
        const {
            imageBase64,
            mimeType,
            fixWrinkles,
            fixTransparency,
            markedImageBase64,
            markedMimeType,
            provider,
            modelName,
        } = await req.json();

        if (!imageBase64 || !mimeType) {
            return NextResponse.json(
                { error: "Missing imageBase64 or mimeType" },
                { status: 400 }
            );
        }

        let apiKey = process.env.GOOGLE_CLOUD_API_KEY;
        let apiKeyName = "GOOGLE_CLOUD_API_KEY";

        if (provider === "gemini") {
            apiKey = process.env.GEMINI_API_KEY;
            apiKeyName = "GEMINI_API_KEY";
        }

        if (!apiKey || apiKey === "your-vertex-api-key-here" || apiKey === "your-gemini-api-key-here") {
            return NextResponse.json(
                { error: `${apiKeyName} is not configured. Please add it to .env.local` },
                { status: 500 }
            );
        }

        let finalPrompt = PROMPT;
        if (fixWrinkles) {
            finalPrompt += `\n\nADDITIONAL INSTRUCTION - FIX WRINKLES: The product has heavy wrinkles and creases on its leather/fabric surface. Smooth out these wrinkles significantly while keeping the natural leather grain texture intact. The surface should look like a brand-new, unwrinkled product fresh from the factory. Remove deep creases, folds, and deformation marks, but preserve natural material texture (grain, pores, stitching).`;
        }
        if (fixTransparency) {
            finalPrompt += `\n\n${FIX_TRANSPARENCY_PROMPT}`;
        }

        const ai = new GoogleGenAI({
            apiKey,
        });

        const parts: Array<
            { text: string } |
            { inlineData: { mimeType: string; data: string } }
        > = [
            { text: finalPrompt },
            {
                inlineData: {
                    mimeType,
                    data: imageBase64,
                },
            },
        ];

        if (fixTransparency && markedImageBase64 && markedMimeType) {
            parts.push({
                text: "A second reference image is attached with red manual markings. Treat every red-marked area as an exact transparency-damage region that must be repaired. Prioritize those marked regions and their immediate edges. Do not repaint or reinterpret unmarked regions unless strictly necessary to blend the repair naturally.",
            });
            parts.push({
                inlineData: {
                    mimeType: markedMimeType,
                    data: markedImageBase64,
                },
            });
        }

        const response = await ai.models.generateContent({
            model: modelName || "gemini-3.1-flash-image-preview",
            contents: [
                {
                    role: "user",
                    parts,
                },
            ],
            config: {
                responseModalities: ["TEXT", "IMAGE"],
            },
        });

        const responseParts = response.candidates?.[0]?.content?.parts;
        if (!responseParts) {
            return NextResponse.json(
                { error: "No response from AI model" },
                { status: 500 }
            );
        }

        for (const part of responseParts) {
            if (part.inlineData?.data) {
                return NextResponse.json({
                    imageBase64: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || "image/png",
                });
            }
        }

        const textParts = responseParts.flatMap((part) => part.text ? [part.text] : []);
        return NextResponse.json(
            { error: `No image generated. Model response: ${textParts.join(" ")}` },
            { status: 500 }
        );
    } catch (error: unknown) {
        console.error("AI Retouch error:", error);

        let status = 500;
        let errorMessage = error instanceof Error ? error.message : "Internal server error";

        if (typeof errorMessage === "string" && errorMessage.startsWith("{")) {
            try {
                const parsed = JSON.parse(errorMessage);
                if (parsed.error) {
                    errorMessage = parsed.error.message || errorMessage;
                    if (parsed.error.code === 429) status = 429;
                }
            } catch {
                // Ignore parse errors
            }
        }

        if (
            (typeof error === "object" &&
                error !== null &&
                "status" in error &&
                error.status === 429) ||
            errorMessage.includes("429")
        ) {
            status = 429;
        }

        return NextResponse.json(
            { error: errorMessage },
            { status }
        );
    }
}
