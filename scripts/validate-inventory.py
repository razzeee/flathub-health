"""Validate saved inventories against immutable official CycloneDX schemas."""
import json
import sys
import urllib.request

from jsonschema import Draft7Validator
from referencing import Registry, Resource

REVISION = "ad83dae28b236b8760286399da4daba77592de86"


def main():
    documents = {}
    resources = []
    for name in ["bom-1.7.schema.json", "bom-1.6.schema.json", "spdx.schema.json", "jsf-0.82.schema.json"]:
        url = f"https://raw.githubusercontent.com/CycloneDX/specification/{REVISION}/schema/{name}"
        with urllib.request.urlopen(url, timeout=30) as response:
            document = json.load(response)
        documents[name] = document
        for protocol in ["http", "https"]:
            resources.append((f"{protocol}://cyclonedx.org/schema/{name}", Resource.from_contents(document)))
    registry = Registry().with_resources(resources)
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8") as stream:
            document = json.load(stream)
        version = document.get("specVersion")
        if version not in ["1.7", "1.6"]:
            raise ValueError("unsupported CycloneDX version")
        validator = Draft7Validator(documents[f"bom-{version}.schema.json"], registry=registry)
        errors = list(validator.iter_errors(document))
        if errors:
            raise ValueError("\n".join(f"{path} {list(error.path)}: {error.message[:300]}" for error in errors[:10]))
        print(f"Validated CycloneDX {version}: {path}")


if __name__ == "__main__":
    main()
