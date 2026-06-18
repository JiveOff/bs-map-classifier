window.BENCHMARK_DATA = {
  "lastUpdate": 1781816787381,
  "repoUrl": "https://github.com/JiveOff/bs-map-classifier",
  "entries": {
    "bs-map-classifier": [
      {
        "commit": {
          "author": {
            "email": "antoine@jiveoff.fr",
            "name": "JiveOff",
            "username": "JiveOff"
          },
          "committer": {
            "email": "antoine@jiveoff.fr",
            "name": "JiveOff",
            "username": "JiveOff"
          },
          "distinct": true,
          "id": "f6b1283be99d3c7a8ae00bf0a30b95c4e0bd131c",
          "message": "ci & docs: improve CI & package README for benchmarks",
          "timestamp": "2026-06-18T23:03:57+02:00",
          "tree_id": "469bbc974214148bfec4d4949e48e9ad197337b6",
          "url": "https://github.com/JiveOff/bs-map-classifier/commit/f6b1283be99d3c7a8ae00bf0a30b95c4e0bd131c"
        },
        "date": 1781816701246,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Init (loadEmbeddedClassifier)",
            "value": 285.96,
            "unit": "ms"
          },
          {
            "name": "classifyMap median",
            "value": 11.713,
            "unit": "ms"
          },
          {
            "name": "classifyMap p95",
            "value": 32.098,
            "unit": "ms"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "antoine@jiveoff.fr",
            "name": "JiveOff",
            "username": "JiveOff"
          },
          "committer": {
            "email": "antoine@jiveoff.fr",
            "name": "JiveOff",
            "username": "JiveOff"
          },
          "distinct": true,
          "id": "8dfb10c0d0ffc88160c1037b2291dd96809f3a5b",
          "message": "ci & docs: no CI in benchmark branch",
          "timestamp": "2026-06-18T23:05:16+02:00",
          "tree_id": "6fdeeab2d5ae97c19fe55071c02f3d3094bcc905",
          "url": "https://github.com/JiveOff/bs-map-classifier/commit/8dfb10c0d0ffc88160c1037b2291dd96809f3a5b"
        },
        "date": 1781816785831,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "Init (loadEmbeddedClassifier)",
            "value": 287.09,
            "unit": "ms"
          },
          {
            "name": "classifyMap median",
            "value": 11.733,
            "unit": "ms"
          },
          {
            "name": "classifyMap p95",
            "value": 31.778,
            "unit": "ms"
          }
        ]
      }
    ]
  }
}