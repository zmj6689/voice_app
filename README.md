**🎧 VOICE_APP**

Not a voice chat tool.
A living space shaped by presence.

**🌱 Looking for a Builder, Not a Spectator**

This project is still small.
But the vision is not.
I’m not looking for a “rockstar developer.”
I’m looking for someone who:

Wants to grow.

Has big dreams.

Doesn’t quit when things get messy.
Cares about building something meaningful.
You don’t need to be the best.

But you need to want to become better.

This is not about fast success.
It’s about long-term building.

If you want to:

Learn real-time systems deeply
Build something artistic and technical
Fail, improve, and iterate

Stay when it’s hard

Open an issue.
Let’s talk.

**What is VOICE_APP?**

VOICE_APP is an experiment.

It is a room.
It is a presence.
It is an interface that reacts.

This project explores a simple question:

What if voice wasn’t just heard —
but felt through space?

Instead of buttons and panels,
users exist as characters.

Instead of static UI,
the room breathes.

Instead of overwhelming features,
only what is necessary remains.

**🎨 Philosophy**

I see this as art before product.
Technology here is not the point.
It is a medium.
The goal is not complexity.
The goal is clarity.
Visual feedback should feel alive.
State changes should feel meaningful.
Silence should feel different from activity.
Presence should shape space.
If something does not improve experience,
it does not belong.

**Design Principles**

1. Restraint over excess
No feature for the sake of feature.

2. Space over clutter
The room is the interface.

3. State is visible
Idle, active, recording — all reflected visually.

4. Emotion through motion
Subtle animation over loud decoration.

**⚙️ Technical Approach**

The system is intentionally simple:
Vanilla JavaScript
Canvas 2D for room VFX
Express + WebSocket backend
Redis for state synchronization
PostgreSQL for persistence
Prisma for schema management

No heavy frameworks.
No unnecessary abstractions.

The architecture supports:

Real-time room interaction

Character-based presence

Host-controlled environment themes

Scalable state management

The technology serves the experience — not the other way around.

**Current Exploration**

Reactive room wave ring
Character-based UI
Spatial feedback
Visual state transitions
Long-press interaction experiments
This is an evolving system.

**Why Open Source?**

Because this is not just a product.
It is an exploration of:
real-time presence
visual minimalism
spatial communication
human-centered interaction

If you are interested in systems that feel alive,
let’s build together.

**📌 Status**

Alpha-stage.
Stable core.
Actively evolving design language.

**🤝 Collaboration*8

Looking for people interested in:

Real-time systems

Expressive UI

Creative coding

Social experimentation

Not for scaling fast.
For building something intentional.

This README was crafted with the help of ChatGPT, as the author is still learning and improving their English.

**🚀 Running Locally** , **This project requires Redis and PostgreSQL to be running locally!**
1. Clone the repository
```bash git clone https://github.com/your-username/voice_app.git```
``` cd voice_app```

3. Install dependencies
```bash npm install```
  

4. Environment setup
Create a .env file in the root directory:
**Make sure PostgreSQL and Redis are running.**
        ```env DATABASE_URL=your_postgres_connection_string```

   ```REDIS_URL=your_redis_connection_string``` 

   ```TURN_PASSWORD=your_turn_password```

5. Run the server
```bash npm start```

6. Open in the browser
```http://localhost:3000```
