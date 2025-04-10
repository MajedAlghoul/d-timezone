const express = require("express");
const { Client, GatewayIntentBits, Events, Partials } = require("discord.js");
const { DateTime } = require("luxon");
const fs = require("fs/promises");
const path = require("path");

// Increase event emitter limits if needed
require('events').EventEmitter.defaultMaxListeners = 15;

// Express server setup
const app = express();
const server = app.listen(process.env.PORT || 3000, () => console.log(`Web server running on port ${process.env.PORT || 3000}`));
app.get("/", (req, res) => res.send("Timezone Bot is alive!"));

// Discord client with modern intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent  // Need this for reading message content
  ],
  partials: [Partials.Message, Partials.Channel]
});

// File paths with proper directory handling
const DATA_DIR = path.join(process.cwd(), "data");
const TIMEZONES_FILE = path.join(DATA_DIR, "timezones.json");
let userTimezones = {};

// Ensure data directory exists and load timezone data
async function initializeDataStorage() {
  try {
    // Create data directory if it doesn't exist
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    try {
      // Try to read existing timezones file
      const data = await fs.readFile(TIMEZONES_FILE, 'utf8');
      userTimezones = JSON.parse(data);
      console.log("Loaded timezone data for", Object.keys(userTimezones).length, "users");
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error("Error reading timezones file:", err);
      } else {
        console.log("No existing timezones file, creating new one");
      }
      // Initialize with empty object if file doesn't exist or is invalid
      userTimezones = {};
      await saveTimezones();
    }
  } catch (err) {
    console.error("Failed to initialize data storage:", err);
  }
}

// Save timezones to file
async function saveTimezones() {
  try {
    await fs.writeFile(TIMEZONES_FILE, JSON.stringify(userTimezones, null, 2));
    return true;
  } catch (err) {
    console.error("Error saving timezones:", err);
    return false;
  }
}

// Update nickname with timezone
async function updateNickname(member, timezone) {
  if (!member || !timezone) return;
  
  try {
    // Skip if we can't change the nickname
    if (!member.manageable) {
      return false;
    }
    
    const currentTime = DateTime.now().setZone(timezone).toFormat("HH:mm");
    
    // Get the base name (everything before the pipe if it exists)
    let baseName = member.displayName;
    if (baseName.includes("|")) {
      baseName = baseName.split("|")[0].trim();
    }
    
    const newName = `${baseName} | ${currentTime}`;
    
    // Only update if the name would change
    if (member.displayName !== newName) {
      await member.setNickname(newName);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`Failed to update nickname for ${member.user.tag}:`, error);
    return false;
  }
}

// Client ready event
client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  initializeDataStorage();
});

// Message event handler
client.on(Events.MessageCreate, async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;
  
  // Check if it's a DM or a guild message
  if (!message.guild) {
    return message.reply("This bot only works in servers, not in DMs.");
  }
  
  const args = message.content.trim().split(/\s+/);
  const command = args[0].toLowerCase();
  
  // Handle set timezone command
  if (command === "!settimezone") {
    const tz = args[1];
    
    // Validate the timezone
    if (!tz) {
      return message.reply(
        "❌ Please specify a timezone. Example: `!settimezone Europe/London`"
      );
    }
    
    try {
      // Test if timezone is valid
      if (!DateTime.now().setZone(tz).isValid) {
        return message.reply(
          "❌ Invalid timezone. Try `!settimezone Europe/London` or `America/New_York`"
        );
      }
      
      // Save user timezone
      userTimezones[message.author.id] = tz;
      await saveTimezones();
      
      // Try to update nickname immediately
      const member = message.member;
      const updated = await updateNickname(member, tz);
      
      const statusMsg = updated ? 
        "and your nickname has been updated!" : 
        "but I couldn't update your nickname due to permissions.";
      
      return message.reply(`✅ Timezone set to **${tz}** ${statusMsg}`);
    } catch (err) {
      console.error("Error setting timezone:", err);
      return message.reply("❌ Error setting timezone. Please check your timezone format.");
    }
  }
  
  // Handle timezone check command
  if (command === "!timezonedebug") {
    try {
      const botMember = message.guild.members.me;
      const hasPermission = botMember.permissions.has("ManageNicknames");
      const highestBotRole = botMember.roles.highest.position;
      
      const userMember = message.member;
      const highestUserRole = userMember.roles.highest.position;
      const isOwner = message.guild.ownerId === message.author.id;
      const isManageable = userMember.manageable;
      
      const userTimezone = userTimezones[message.author.id];
      const currentTime = userTimezone ? 
        DateTime.now().setZone(userTimezone).toFormat("HH:mm") : 
        "No timezone set";
      
      return message.reply(
        `**Discord Permission Debug:**\n` +
        `- Bot has MANAGE_NICKNAMES permission: ${hasPermission}\n` +
        `- Bot's highest role position: ${highestBotRole}\n` +
        `- Your highest role position: ${highestUserRole}\n` +
        `- Bot's role is higher than yours: ${highestBotRole > highestUserRole}\n` +
        `- You are the server owner: ${isOwner}\n` +
        `- Your nickname is manageable by bot: ${isManageable}\n` +
        `- Your current timezone: ${userTimezone || "Not set"}\n` +
        `- Your current time: ${currentTime}\n\n` +
        `**Recommendation:** ${isManageable ? 
          "Your nickname can be changed by the bot." : 
          isOwner ? 
            "You are the server owner. Discord doesn't allow bots to change the owner's nickname." : 
            "The bot's highest role must be above your highest role in the server settings."}`
      );
    } catch (error) {
      console.error("Debug command error:", error);
      return message.reply("Error running debug command: " + error.message);
    }
  }
  
  // Handle manual time check command
  if (command === "!mytime") {
    const tz = userTimezones[message.author.id];
    if (!tz) {
      return message.reply("❌ You haven't set a timezone yet. Use `!settimezone` first.");
    }
    
    const currentTime = DateTime.now().setZone(tz).toFormat("HH:mm");
    return message.reply(`Your current time (${tz}): **${currentTime}**`);
  }
  
  // Skip if no timezone is set for this user
  const tz = userTimezones[message.author.id];
  if (!tz) return;
  
  try {
    // Update nickname with current time
    await updateNickname(message.member, tz);
  } catch (error) {
    console.error("Error updating nickname:", error);
  }
});

// Handle errors
client.on(Events.Error, error => {
  console.error("Discord client error:", error);
});

// Proper shutdown handling
function shutdown() {
  console.log("Shutting down...");
  
  // Close the Express server
  server.close(() => {
    console.log("Web server closed");
    
    // Destroy the Discord client
    client.destroy();
    console.log("Discord client destroyed");
    
    process.exit(0);
  });
  
  // Force exit if graceful shutdown fails
  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

// Listen for termination signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

// Login with Discord token
client.login(process.env.DISCORD_TOKEN);