import type { SimpleRouteJson } from "../../lib"

export function offsetNativePair(): SimpleRouteJson {
  const connections = ["P", "N"].map((name, i) => ({
    name, pointsToConnect: [
      {x:-6,y:-1.5+i,layer:"top"},
      {x:6,y:.5+i,layer:"top"},
    ],
  }))
  return {
    layerCount:4,allowedLayers:["inner1"],minTraceWidth:.1,
    minTraceToPadEdgeClearance:.1,minViaPadDiameter:.3,minViaHoleDiameter:.15,
    minBoardEdgeClearance:.2,allowViaInPad:false,
    bounds:{minX:-8,maxX:8,minY:-5,maxY:5},
    connections,
    obstacles:connections.flatMap(c=>c.pointsToConnect.map((p,i)=>({
      type:"rect",shape:"circle" as const,componentId:`package_${i}`,
      center:{x:p.x,y:p.y},width:.4,height:.4,layers:["top"],connectedTo:[c.name],
    }))),
    differentialPairs:[{connectionNames:["P","N"],lengthTolerance:.1,traceGap:.1}],
  }
}
