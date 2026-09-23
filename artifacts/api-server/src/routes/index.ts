import { Router, type IRouter } from "express";
import healthRouter from "./health";
import processingRouter from "./processing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(processingRouter);

export default router;
