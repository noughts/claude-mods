# claude-mods

Mods for Claude Code (terminal and desktop app). A mod is an extension that changes Claude's own interface or behaviour, and is installed as a plugin.

## Mods

### session-cost

Shows what the current session has cost so far, next to the model name under the prompt, as `$3.55`.

Click it, or run `/session-cost`, to open or close a details panel. The panel shows:

- Cost (session total, in US dollars)
- Claude's hourly rate (the cost added during API time ÷ API time)
- Time breakdown
  - Wall: time since the session started. Close to the wall duration in `/cost`
  - Turns: total length of the main turns, including tool runs such as builds
  - API: total time from sending each model request until its response ends, subagents included. Close to the API duration in `/cost`
- Token breakdown (input, output, cache read, cache write)
- Context usage and percentage

The hourly rate is divided by API time so that time spent without using tokens, such as waiting on a build, does not make the rate differ from project to project.

Turns, API, the hourly rate and the token breakdown start counting when the mod is added. The display updates at the end of each turn.

The display is available in English and Japanese. It is shown in Japanese when the OS language is Japanese, and in English otherwise. On macOS the mod reads the system's preferred language by running `defaults read -g AppleLanguages` once at session start; elsewhere it reads the locale environment variables (`LC_ALL`, `LC_MESSAGES`, `LANG`).

### five-hour-usage

Shows how much of the 5-hour usage limit is used, under the prompt beside the model name, as `5h 90%`.

The usage ring in the desktop app shows whichever limit is closest to running out, so it can read 90% because of the weekly limit while the 5-hour window is barely used. This mod shows the 5-hour window alone.

The figure comes from the usage limits that the latest API response reported, and it updates each time it moves by a point. Once the window's reset time has passed, it shows `5h 0%` until the next response. Nothing is shown before the first reading, or when the account has no 5-hour limit, as with API billing.

## Install

At the prompt of a terminal session (replace `session-cost` with `five-hour-usage` for the other mod):

```
/plugin install session-cost --marketplace noughts/claude-mods
```

From a shell:

```
claude plugin install session-cost --marketplace noughts/claude-mods
```

Answer `y` to `Add marketplace?`, then choose the user scope.

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `noughts/claude-mods`, then Add plugin.

## Update

From a shell, refresh the marketplace, then update the mod:

```
claude plugin marketplace update noughts
```

```
claude plugin update session-cost@noughts
```

(`five-hour-usage@noughts` for the other mod.)

The update applies to sessions started afterwards.

## Notes

The mod API is in early access and may change between Claude Code releases without notice. These mods were checked on the desktop app of Claude Code 2.1.321.

## License

MIT
