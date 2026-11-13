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

app.use(express.json({ limit: "10kb" }));

// CORS: set FRONTEND_URL in Render to your Netlify website URL.
app.use((req, res, next) => {
const origin = process.env.FRONTEND_URL;
if (origin && req.headers.origin === origin) {
res.setHeader("Access-Control-Allow-Origin", origin);
}
res.setHeader("Vary", "Origin");
res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");
if (req.method === "OPTIONS") return res.sendStatus(204);
next();
});

app.use(express.static(path.join(__dirname, "public")));

const SESSION_DIR = path.join(__dirname, "session");

let sock = null;
let isConnected = false;
let isStarting = false;
let startPromise = null;
let lastPairRequest = 0;

async function connectWhatsApp() {
if (isStarting) return startPromise;

isStarting = true;  

startPromise = (async () => {  
    try {  
        fs.mkdirSync(SESSION_DIR, { recursive: true });  

        const { state, saveCreds } =  
            await useMultiFileAuthState(SESSION_DIR);  

        const { version } = await fetchLatestBaileysVersion();  

        const newSock = makeWASocket({  
            version,  
            auth: state,  
            logger: pino({ level: "silent" }),  
            printQRInTerminal: false,  
            browser: ["XYTRAX GROUP ID", "Chrome", "1.0.0"]  
        });  

        sock = newSock;  
        newSock.ev.on("creds.update", saveCreds);  

        newSock.ev.on("connection.update", (update) => {  
            const { connection, lastDisconnect } = update;  

            if (connection === "open") {  
                isConnected = true;  
                console.log("XYTRAX WhatsApp connected.");  
            }  

            if (connection === "close") {  
                isConnected = false;  
                if (sock === newSock) sock = null;  

                const statusCode =  
                    lastDisconnect?.error?.output?.statusCode;  

                console.log("WhatsApp disconnected:", statusCode);  

                if (statusCode === 401 || statusCode === 403) {  
                    console.log("Session logged out. Pair again.");  
                    return;  
                }  

                setTimeout(() => connectWhatsApp(), 5000);  
            }  
        });  

    } catch (error) {  
        console.error("WhatsApp startup error:", error);  
        setTimeout(() => connectWhatsApp(), 10000);  
    } finally {  
        isStarting = false;  
    }  
})();  

return startPromise;

}

// Request a WhatsApp pairing code for your own number.
app.post("/api/pair", async (req, res) => {
try {
const now = Date.now();

if (now - lastPairRequest < 30000) {  
        return res.status(429).json({  
            success: false,  
            error: "Please wait 30 seconds before requesting another code."  
        });  
    }  

    const rawNumber = req.body?.phoneNumber;  

    if (typeof rawNumber !== "string") {  
        return res.status(400).json({  
            success: false,  
            error: "Enter your phone number with country code."  
        });  
    }  

    const phoneNumber = rawNumber.replace(/\D/g, "");  

    if (!/^\d{10,15}$/.test(phoneNumber)) {  
        return res.status(400).json({  
            success: false,  
            error: "Enter a valid phone number with country code, without +."  
        });  
    }  

    if (isConnected) {  
        return res.json({  
            success: true,  
            connected: true,  
            message: "WhatsApp is already connected."  
        });  
    }  

    if (sock?.authState?.creds?.registered) {  
        return res.status(409).json({  
            success: false,  
            error: "A WhatsApp session is already registered."  
        });  
    }  

    await connectWhatsApp();  

    // Allow the WhatsApp socket to initialize.  
    await new Promise(resolve => setTimeout(resolve, 2000));  

    if (!sock) {  
        return res.status(503).json({  
            success: false,  
            error: "WhatsApp is starting. Please try again shortly."  
        });  
    }  

    lastPairRequest = now;  

    const code = await sock.requestPairingCode(phoneNumber);  

    return res.json({  
        success: true,  
        pairingCode: code,  
        message: "Enter this code in WhatsApp Linked Devices."  
    });  

} catch (error) {  
    console.error("Pairing error:", error);  

    return res.status(500).json({  
        success: false,  
        error: "Could not generate a pairing code. Please try again."  
    });  
}

});

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

// Retrieve a group ID from an invite link.
app.post("/api/group-id", async (req, res) => {
try {
const { link } = req.body || {};

if (typeof link !== "string") {  
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
            error: "WhatsApp is not connected yet."  
        });  
    }  

    const result = await sock.groupGetInviteInfo(match[1]);  

    if (!result?.id) {  
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
        error: "Unable to retrieve group ID. Check the invite link."  
    });  
}

});

app.listen(PORT, () => {
console.log(`XYTRAX running on port ${PORT}`);
});

