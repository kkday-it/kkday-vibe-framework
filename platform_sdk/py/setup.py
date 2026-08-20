from setuptools import setup, find_packages

setup(
    name="platform_sdk",
    version="0.2.0",
    package_dir={"": "src"},
    packages=find_packages(where="src"),
    install_requires=[
        # 釘住相容範圍以確保 build 可重現(Spec §2.1)
        "python-dotenv>=1.0,<2",
        "playwright>=1.40,<2",   # 主引擎(§12-6);首次使用需 playwright install chromium
        "pyyaml>=6.0,<7",
        "requests>=2.31,<3",
    ],
    extras_require={
        # S3 storage adapter(STORAGE_PROVIDER=s3;走預設憑證鏈,零 key)
        "s3": ["boto3>=1.34,<2"],
        # Selenium 降級相容(get_driver 已標 Deprecation;example 改寫完移除)
        "legacy-selenium": ["selenium", "webdriver-manager"],
    },
    description="Enterprise Workflows local shim — ctx.* 介面凍結、實作可換",
)
