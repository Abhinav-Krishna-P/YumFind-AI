import { motion } from 'framer-motion';

export function YumMark({ speak }: { speak?: string }) {
  return (
    <motion.div
      className="pointer-events-none absolute bottom-6 left-4 z-20 flex items-end gap-2"
      initial={{ opacity: 0, y: 40, rotate: -8 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 360, damping: 18 }}
    >
      <motion.div
        className="relative grid h-20 w-20 place-items-center rounded-full border-[3px] border-ink bg-grape shadow-[6px_6px_0_#14080c]"
        animate={{ y: [0, -6, 0] }}
        transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
      >
        <span className="absolute left-5 top-6 h-2 w-2 rounded-full bg-cream" />
        <span className="absolute right-5 top-6 h-2 w-2 rounded-full bg-cream" />
        <span className="mt-3 h-3 w-6 rounded-b-full border-b-4 border-cream" />
      </motion.div>
      {speak ? (
        <div className="mb-12 max-w-40 rounded-2xl rounded-bl-sm border-2 border-ink bg-cream px-3 py-2 text-xs font-semibold">
          {speak}
        </div>
      ) : null}
    </motion.div>
  );
}
