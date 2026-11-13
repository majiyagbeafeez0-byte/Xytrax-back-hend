
const express = require("express");
const path = require("path");
const fs = require("fs");
const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let sock = null;
let isConnected = false;
let isStarting = false;

const SESSION_DIR = path.join(__dirname, "session");

async function connectWhatsApp() {
    if (isStarting) return;

    isStarting = true;

    try {
        const { state, saveCreds } =
            await useMultiFileAuthState(SESSION_DIR);

        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: "silent" }),
            printQRInTerminal: false,
            browser: ["XYTRAX GROUP ID", "Chrome", "1.0.0"]
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                isConnected = true;
                console.log("WhatsApp connected successfully!");
            }

            if (connection === "close") {
                isConnected = false;
                sock = null;

                const statusCode =
                    lastDisconnect?.error?.output?.statusCode;

                console.log("WhatsApp disconnected:", statusCode);

                // Logged-out sessions need fresh authentication.
                if (
                    statusCode === 401 ||
                    statusCode === 403
                ) {
                    console.log("WhatsApp session requires re-authentication.");
                    return;
                }

                setTimeout(() => {
                    connectWhatsApp();
                }, 5000);
            }
        });

    } catch (error) {
        console.error("WhatsApp connection error:", error);

        setTimeout(() => {
            connectWhatsApp();
        }, 10000);

    } finally {
        isStarting = false;
    }
}

// Connection status
app.get("/api/status", (req, res) => {
    res.json({
        success: true,
        connected: isConnected,
        message: isConnected
            ? "WhatsApp connected"
            : "WhatsApp not connected"
    });
});

// Get WhatsApp Group ID
app.post("/api/group-id", async (req, res) => {
    try {
        const { link } = req.body || {};

        if (!link || typeof link !== "string") {
            return res.status(400).json({
                success: false,
                error: "Please enter a WhatsApp group invite link."
            });
        }

        const match = link.trim().match(
            /^https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)\/?$/
        );

        if (!match) {
            return res.status(400).json({
                success: false,
                error: "Invalid WhatsApp group invite link."
            });
        }

        if (!isConnected || !sock) {
            return res.status(503).json({
                success: false,
                error: "WhatsApp is not connected yet. Please wait."
            });
        }

        const inviteCode = match[1];

        const result = await sock.groupGetInviteInfo(inviteCode);

        if (!result || !result.id) {
            return res.status(404).json({
                success: false,
                error: "Group ID could not be retrieved."
            });
        }

        return res.json({
            success: true,
            groupId: result.id,
            message: "Group ID retrieved successfully."
        });

    } catch (error) {
        console.error("Group lookup error:", error);

        return res.status(400).json({
            success: false,
            error: "Unable to retrieve group ID. Check the invite link and WhatsApp connection."
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`XYTRAX running on port ${PORT}`);
    connectWhatsApp();
});
