export default function AmbientOrbs() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      {/* Large blue orb — top left */}
      <div
        className="absolute rounded-full animate-orb"
        style={{
          width: 500,
          height: 500,
          top: -150,
          left: -150,
          background: 'radial-gradient(circle, rgba(59,130,246,0.18) 0%, transparent 70%)',
          filter: 'blur(60px)',
          animationDuration: '18s',
        }}
      />
      {/* Purple orb — bottom right */}
      <div
        className="absolute rounded-full animate-orb"
        style={{
          width: 450,
          height: 450,
          bottom: -100,
          right: -100,
          background: 'radial-gradient(circle, rgba(168,85,247,0.16) 0%, transparent 70%)',
          filter: 'blur(70px)',
          animationDuration: '22s',
          animationDelay: '-6s',
        }}
      />
      {/* Cyan orb — center */}
      <div
        className="absolute rounded-full animate-orb"
        style={{
          width: 320,
          height: 320,
          top: '40%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          background: 'radial-gradient(circle, rgba(6,182,212,0.10) 0%, transparent 70%)',
          filter: 'blur(80px)',
          animationDuration: '16s',
          animationDelay: '-3s',
        }}
      />
      {/* Pink accent — top right */}
      <div
        className="absolute rounded-full animate-orb"
        style={{
          width: 280,
          height: 280,
          top: 80,
          right: -60,
          background: 'radial-gradient(circle, rgba(236,72,153,0.10) 0%, transparent 70%)',
          filter: 'blur(55px)',
          animationDuration: '20s',
          animationDelay: '-10s',
        }}
      />
    </div>
  );
}
