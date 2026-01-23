import { Check, Play, Pause, Circle } from 'lucide-react'

export function WorkflowLegend() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-3">
          Workflow Status Legend
        </h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <Check className="w-3 h-3 text-emerald-600" />
            </div>
            <span className="text-xs text-muted-foreground">Completed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center">
              <Play className="w-3 h-3 text-blue-600" />
            </div>
            <span className="text-xs text-muted-foreground">In Progress</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-4 h-4 rounded-full bg-yellow-100 flex items-center justify-center">
              <Pause className="w-3 h-3 text-yellow-600" />
            </div>
            <span className="text-xs text-muted-foreground">Pending (Ready)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-4 h-4 rounded-full bg-muted flex items-center justify-center">
              <Circle className="w-3 h-3 text-muted-foreground" />
            </div>
            <span className="text-xs text-muted-foreground">Not Started</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-foreground mb-3">
          Edge States
        </h3>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-8 h-0.5 bg-emerald-500"></div>
            <span className="text-xs text-muted-foreground">Completed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-8 h-0.5 bg-muted-foreground" style={{ backgroundImage: 'repeating-linear-gradient(to right, currentColor 0, currentColor 4px, transparent 4px, transparent 8px)' }}></div>
            <span className="text-xs text-muted-foreground">Pending/Next</span>
          </div>
        </div>
      </div>
    </div>
  )
}
