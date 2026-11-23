"""產生 tools/work/emu_boot.js: 把模擬器與差分測試輔助合併成一個腳本並在結尾開機到標題選單。
給無法 eval / vm 載入多檔的執行環境用 (本機 Node 請直接用 run_local.js)。
用法: python tools/emu/make_sandbox_boot.py"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "..", "work")
FILES = ["x86emu.js", "dosenv.js", "harness.js", "harness_menu.js", "boot_title.js", "boot_port.js"]
BOOT = ";(function(){const t0=Date.now(); session.boot(WORKSPACE_DIR); session.bootTitle(); console.log('[boot] '+((Date.now()-t0)/1000).toFixed(1)+'s');})();\n"


def main():
    parts = [open(os.path.join(HERE, f), encoding="utf-8").read() for f in FILES] + [BOOT]
    os.makedirs(WORK, exist_ok=True)
    open(os.path.join(WORK, "emu_boot.js"), "w", encoding="utf-8").write("\n;\n".join(parts))


if __name__ == "__main__":
    main()
