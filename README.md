# Varnox X Crasher

Varnox X Crasher is a branded WhatsApp pairing website based on the original Squichy Free web interface. The website provides country selection, phone-number pairing, connected-number status, and an owner console while keeping the bot runtime outside this repository.

## Website structure

The deployable site is in `Squichy Free (Web)/`. Its Vercel configuration routes `/` to `index.html`, `/owner` and `/admin` to `owner.html`, and `/api/*` to the Express pairing API.

The Varnox X Crasher artwork is stored at `Squichy Free (Web)/assets/varnox-x-crasher.png` and is used as the visual background on the public pairing page and owner console. No bot source or WhatsApp session data is included in this website fork.

## Local validation

From the website directory:

```bash
npm install
node -e "require('./api')"
```

The site is a static HTML/CSS/JavaScript frontend with a small Express API entrypoint for the existing pairing routes. Configure the required deployment environment values in Vercel before using live pairing features.

## Vercel deployment

Set the Vercel project root to `Squichy Free (Web)/`, or import the repository and configure that directory as the Root Directory. The included `vercel.json` contains the required rewrites for the public page, owner console, and API routes.

## Scope

This repository contains the website only. The Varnox WhatsApp bot runtime, pairing sessions, and server credentials are intentionally not included.
