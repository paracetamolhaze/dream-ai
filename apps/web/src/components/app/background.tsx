/** Fixed night-sky backdrop: drifting aurora blobs, stars and film grain (CSS only). */
export function NightSky() {
  return (
    <div className="night-sky" aria-hidden>
      <div className="night-sky__blob night-sky__blob--a" />
      <div className="night-sky__blob night-sky__blob--b" />
      <div className="night-sky__blob night-sky__blob--c" />
      <div className="night-sky__stars" />
      <div className="night-sky__stars night-sky__stars--twinkle" />
      <div className="night-sky__grain" />
      <div className="night-sky__vignette" />
    </div>
  );
}
