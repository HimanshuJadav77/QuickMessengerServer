import { Router } from "express";

const router = Router();

router.get("/",(req,res)=>{
    return res.status(200).json({
        success:true,
        message:"Quick Messenger Server Running..",
        version:"v1.0.0"
    });
});

export default router;