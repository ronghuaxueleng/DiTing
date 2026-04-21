# 🧠 谛听 (DiTing) Mindmap Shortcuts Guide

Welcome to the keyboard navigation guide for the AI Notes Mindmap component. You can fully traverse, organize, and view your transcribed notes without ever reaching for your mouse!

> [!NOTE] 
> To activate these shortcuts, **click anywhere inside the mindmap panel** to grant it keyboard focus. 

## 🗺️ Navigation (Directional)

Use the Arrow Keys to fluidly traverse the mindmap nodes:

| Key | Action | Intelligent Details |
| :--- | :--- | :--- |
| **`ArrowRight`** | Go to First Child | Acts as a **Depth-First Search (DFS) trigger**. Press it continuously to automatically expand hidden children, jump out of exhausted branches, and traverse every single node in reading order. |
| **`ArrowLeft`** | Go to Parent | Instantly jumps focus to the parent node of the currently highlighted concept. |
| **`ArrowUp`** | Previous Sibling | Navigates to the node directly above the current one. If you're at the top, it automatically "jumps" up the tree to the uncle/grandparent's previous sibling. |
| **`ArrowDown`** | Next Sibling | Navigates to the node directly below the current one. If you're at the bottom, it jumps to the next available branch in the hierarchy. |

## 🕹️ Interaction & View

Keep your node in focus or arrange the layout:

| Key | Action | Description |
| :--- | :--- | :--- |
| **`Space`** | Toggle | Expands or collapses the children of the currently highlighted node. |
| **`Enter`** | Center & Zoom | Activates the **Focus Mode**. It forcefully pulls the currently selected node to the absolute center of your screen and zooms it to a perfectly readable 100% scale. |
| **`Ctrl` + `Enter`** / **`Cmd` + `Enter`** | Fit to Screen | Instantly zooms out and recenters to show the **entire** mindmap on your screen at once. |

## 🔍 Zooming & Hierarchy Depth

Control the scope and scale of what you are viewing:

| Key / combination | Action | Description |
| :--- | :--- | :--- |
| **`Ctrl` + `ArrowUp`** | Zoom In (+) | Enlarges the mindmap, anchoring safely centered around whatever node you are currently focused on. |
| **`Ctrl` + `ArrowDown`** | Zoom Out (-) | Shrinks the mindmap, keeping the current node as the anchor point. |
| **`1` - `9` Number Keys** | Change Max Depth | Instantly sets how many hierarchical levels (depths) the mindmap should display. E.g., pressing `2` instantly collapses the entire tree down to only show the root and its direct children. *Pressing the same number again forcefully tidies up any manually expanded nodes back to that limit.* |

> [!TIP]
> **Smart Panning Active:** As you navigate using arrow keys, the canvas only moves when your node approaches the outer 20% of the screen. This reduces "motion sickness" and visual shaking during rapid traversal!
