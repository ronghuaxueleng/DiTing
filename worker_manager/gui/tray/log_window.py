"""Log viewing window (tkinter)."""

import tkinter as tk
from tkinter import ttk
from tkinter.scrolledtext import ScrolledText

from ...worker.process_manager import WorkerProcessManager
from ...i18n import t


def show_log_window(worker: WorkerProcessManager):
    """Open a standalone log window showing worker output."""
    win = tk.Toplevel() if tk._default_root else tk.Tk()
    win.title(t("log.title"))
    win.geometry("800x500")

    style = ttk.Style()
    style.theme_use("clam")

    frame = ttk.Frame(win)
    frame.pack(expand=True, fill="both", padx=5, pady=5)

    text = ScrolledText(
        frame, state="disabled",
        bg="#1e1e1e", fg="#d4d4d4",
        font=("Consolas", 10),
    )
    text.pack(expand=True, fill="both")

    def poll():
        lines = worker.get_logs(50)
        if lines:
            text.configure(state="normal")
            for line in lines:
                text.insert(tk.END, line + "\n")
            text.see(tk.END)
            text.configure(state="disabled")
        win.after(200, poll)

    poll()
    win.lift()
    win.focus_force()
