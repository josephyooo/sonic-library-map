import type {
  SpotifyTrack,
  AudioFeatures,
  SpotifyPlaylist,
  SpotifyArtist,
} from "./spotify";

export interface LibraryData {
  tracks: SpotifyTrack[];
  playlists: SpotifyPlaylist[];
  playlistTracks: Record<string, string[]>;
  audioFeatures: AudioFeatures[];
  artists: SpotifyArtist[];
  fetchedAt: number;
}
