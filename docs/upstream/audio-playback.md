# Request: audio playback for mods on Linux and Windows terminals

A draft for Kevin to send to Anthropic, through Claude Code's feedback channel (`/feedback`) or its
issue tracker. Checked against Claude Code 2.1.296.

---

**Title:** `$.audio.play` skips every clip on Linux and Windows terminals, and a mod cannot tell

**What happens.** A mod plays a sound file of its own with `$.audio.play({ asset }, { gain })`. On
a macOS terminal the engine plays it through `afplay`. On a Linux or Windows terminal it logs
"no audio player on <os>; not played" and resolves at once; the declarations describe the promise
as "played or skipped". The desktop app plays the same clip through its own audio element on any
system, so the gap is the terminal surface off macOS.

**Why a mod cannot work around it.** A mod's footprint is interface, state, store, clock, HTTP and
commands. It may not spawn a process, so it cannot run a player itself, and it has no other path to
the speakers.

**The players are there.** Each system ships or commonly has a command-line player the engine
could use as it uses `afplay`:

- Linux: `pw-play` (PipeWire), `paplay` (PulseAudio) and `aplay` (ALSA), in that order of
  preference on a current desktop.
- Windows: PowerShell's media player, `System.Media.SoundPlayer` for a WAV file
  (`(New-Object Media.SoundPlayer '<file>').PlaySync()`), with no install needed.

**Why it matters to a mod.** Promptfall, an idle RPG that runs above the prompt, plays a short cue
with a few of its notifications: a rare drop, a level-up, a world boss. On Linux and Windows the
setting reads on and nothing is heard. Today the only way to know a play was skipped is to time
it: the promise resolves within a few milliseconds instead of after the clip ends. That works, but
it rests on an implementation detail and breaks for a clip shorter than the threshold.

**The asks.**

1. Playback on all three terminals: macOS as today, Linux through the first of `pw-play`,
   `paplay` or `aplay` found, Windows through PowerShell's media player.
2. A signal a mod can read when a play was skipped, so a settings screen can say so instead of
   showing sound as on. Any one of these would do:
   - the promise rejects with a reason such as `no-player`;
   - it resolves with a result, `{ played: false, reason: 'no-player' }`;
   - a capability flag readable before any play, such as `$.audio.available`.

The second ask stands even with the first done: a system can still lack every player (a server
with no audio, a minimal container), and a mod should be able to say so.

Thank you.
