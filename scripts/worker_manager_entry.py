"""
PyInstaller entry point for DiTing Worker Manager.

This file exists at the project root level so that PyInstaller can properly
resolve the worker_manager package and its relative imports.
"""

from worker_manager.main import main

if __name__ == "__main__":
    main()
