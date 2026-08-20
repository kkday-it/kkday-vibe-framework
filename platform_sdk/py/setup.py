from setuptools import setup, find_packages

setup(
    name="platform_sdk",
    version="0.2.0",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    install_requires=[
        "python-dotenv",
        "playwright",   # 主引擎(§12-6);首次使用需 playwright install chromium
        "pyyaml",
        "requests",
    ],
    extras_require={
        # Selenium 降級相容(get_driver 已標 Deprecation;example 改寫完移除)
        "legacy-selenium": ["selenium", "webdriver-manager"],
    },
    description="Enterprise Workflows local shim — ctx.* 介面凍結、實作可換",
)
