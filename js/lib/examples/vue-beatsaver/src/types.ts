export interface DiffPair {
  characteristic: string
  difficulty:     string
}

export interface BSMapInfo {
  metadata: {
    songName:        string
    songAuthorName:  string
    levelAuthorName: string
    bpm:             number
  }
  versions: Array<{
    hash:  string
    diffs: DiffPair[]
  }>
}
