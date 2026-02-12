# Asteroids

A classic Asteroids arcade game built with HTML5 Canvas and vanilla JavaScript. Faithful to the original Atari vector-style aesthetic with all sound effects generated procedurally using the Web Audio API.

## Play

[Play online](https://andyrat33.github.io/Asteroids/) or open `index.html` locally in any modern browser. No build step or dependencies required.

## Controls

| Key | Action |
|-----|--------|
| Arrow Keys / WASD | Rotate and thrust |
| Space | Fire |
| Shift | Hyperspace (random teleport, 3s cooldown) |
| P | Pause |
| S | Toggle all sound on/off |
| F | Toggle fire sound on/off |
| Enter | Start game / return to title |

## Features

- Classic vector wireframe graphics
- Asteroids split from large to medium to small
- UFO saucers — large (random fire) and small (aimed fire, appears at higher scores)
- Hyperspace with 1-in-8 chance of exploding on re-entry
- Increasing difficulty each level
- Extra life every 10,000 points
- High score saved to localStorage
- Full procedural audio: heartbeat pulse, thrust rumble, fire blip, explosions, UFO warble, extra life chime
- Fullscreen responsive canvas
